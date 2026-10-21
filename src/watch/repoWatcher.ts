import { Client, TextChannel } from "discord.js";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  RepoWatch,
  getRepoWatch,
  setRepoWatch,
  deleteRepoWatch,
  listRepoWatches,
} from "../store/repoWatches";

const run = promisify(execFile);

export type Visibility = "public" | "private" | "unknown";

/** channelId → 計時器 */
const timers = new Map<string, NodeJS.Timeout>();

/**
 * 用未認證的 GitHub API 查 repo。未認證是刻意的：GitHub App 若已被安裝到該 repo，
 * 即使 repo 還是 private 也拿得到 200，那就永遠測不出「什麼時候對外公開」。
 */
export async function checkVisibility(repo: string): Promise<Visibility> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "discord-github-bot-watcher",
    },
  });

  if (res.status === 200) return "public";
  if (res.status === 404) return "private";
  logger.warn("watch", `Unexpected status ${res.status} for ${repo}`);
  return "unknown";
}

async function hasGit(): Promise<boolean> {
  try {
    await run("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const EXEC_OPTS = { timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 } as const;

/**
 * 沒有 git 時的退路：抓 GitHub 的 tarball 再解壓。
 * 這台 VM 的帳號不在 google-sudoers 群組、密碼也是鎖定的，裝不了 git，
 * 但 curl 與 tar 是系統內建的。缺點是拿不到 git 歷史，之後不能 pull。
 */
async function fetchTarball(repo: string, dest: string): Promise<string> {
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.tar.gz`);
  try {
    await run(
      "curl",
      [
        "-fsSL",
        "-H", "Accept: application/vnd.github+json",
        "-H", "User-Agent: discord-github-bot-watcher",
        `https://api.github.com/repos/${repo}/tarball`,
        "-o", tmp,
      ],
      EXEC_OPTS
    );
    fs.mkdirSync(dest, { recursive: true });
    await run("tar", ["-xzf", tmp, "--strip-components=1", "-C", dest], EXEC_OPTS);
    return "（此機器沒有 git，改用 GitHub tarball 下載並解壓；無 git 歷史，不能 pull）";
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 暫存檔清不掉就算了 */
    }
  }
}

async function cloneRepo(repo: string): Promise<{ dest: string; log: string }> {
  const baseDir = path.resolve(process.cwd(), config.watch.cloneDir);
  const dest = path.join(baseDir, repo.split("/")[1]);
  fs.mkdirSync(baseDir, { recursive: true });

  if (fs.existsSync(dest)) {
    return { dest, log: "目錄已存在，略過下載" };
  }

  if (await hasGit()) {
    const { stdout, stderr } = await run(
      "git",
      ["clone", "--depth", "1", `https://github.com/${repo}.git`, dest],
      EXEC_OPTS
    );
    return { dest, log: `${stdout}${stderr}`.trim() || "git clone 完成" };
  }

  return { dest, log: await fetchTarball(repo, dest) };
}

export async function diskReport(dir: string): Promise<string> {
  const lines: string[] = [];
  try {
    const { stdout } = await run("df", ["-h", dir]);
    lines.push(stdout.trim());
  } catch (e) {
    lines.push(`df 失敗: ${String(e)}`);
  }
  try {
    const { stdout } = await run("du", ["-sh", dir]);
    lines.push(`clone 大小: ${stdout.trim()}`);
  } catch {
    /* du 不存在就算了，df 才是重點 */
  }
  return lines.join("\n");
}

async function send(
  client: Client,
  channelId: string,
  content: string,
  mentionEveryone: boolean
): Promise<void> {
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) {
      logger.warn("watch", `Channel ${channelId} is not text-based`);
      return;
    }
    await (ch as TextChannel).send({
      content,
      allowedMentions: mentionEveryone ? { parse: ["everyone"] } : { parse: [] },
    });
  } catch (e) {
    logger.error("watch", `Failed to send message to channel ${channelId}`, e);
  }
}

/** repo 公開後：clone + 磁碟回報，回傳要貼到頻道的訊息內容 */
export async function handlePublic(repo: string): Promise<string> {
  const url = `https://github.com/${repo}`;
  try {
    const { dest, log } = await cloneRepo(repo);
    const disk = await diskReport(dest);
    return (
      `@everyone 🎉 **\`${repo}\` 已經公開了！**\n${url}\n\n` +
      `已 clone 到 GCP VM：\`${dest}\`\n\`\`\`\n${log}\n\n${disk}\n\`\`\``
    );
  } catch (e) {
    logger.error("watch", "Clone failed", e);
    return (
      `@everyone 🎉 **\`${repo}\` 已經公開了！**\n${url}\n\n` +
      `⚠️ 但自動 clone 失敗，請手動處理：\n\`\`\`\n${String(e).slice(0, 1500)}\n\`\`\``
    );
  }
}

async function tick(client: Client, channelId: string): Promise<void> {
  const watch = await getRepoWatch(channelId);
  if (!watch || watch.doneAt) {
    stopWatch(channelId);
    return;
  }

  let visibility: Visibility;
  try {
    visibility = await checkVisibility(watch.repo);
  } catch (e) {
    logger.error("watch", "Visibility check failed", e);
    watch.lastStatus = "error";
    watch.lastCheckedAt = new Date().toISOString();
    await setRepoWatch(watch);
    await send(client, channelId, `⚠️ \`${watch.repo}\` 檢查失敗：${String(e)}`, false);
    return;
  }

  watch.lastStatus = visibility;
  watch.lastCheckedAt = new Date().toISOString();

  if (visibility !== "public") {
    const label = visibility === "private" ? "仍是 private（404）" : "狀態不明";
    logger.info("watch", `${watch.repo}: ${label}`);
    await setRepoWatch(watch);
    if (watch.notifyOnPrivate) {
      const ts = new Date().toISOString().replace("T", " ").slice(0, 16);
      await send(client, channelId, `🔒 ${ts} UTC — \`${watch.repo}\` ${label}，尚未公開。`, false);
    }
    return;
  }

  logger.info("watch", `${watch.repo} is PUBLIC — cloning`);
  const body = await handlePublic(watch.repo);
  watch.doneAt = new Date().toISOString();
  await setRepoWatch(watch);
  await send(client, channelId, body, true);
  stopWatch(channelId);
  logger.info("watch", `Watcher for channel ${channelId} stopped (repo is public)`);
}

/** 啟動（或重啟）某頻道的 watcher；會立刻掃一次 */
export function startWatch(client: Client, watch: RepoWatch): void {
  stopWatch(watch.channelId);
  if (watch.doneAt) return;

  const intervalMs = Math.max(1, watch.intervalMinutes) * 60 * 1000;
  const safeTick = () => {
    tick(client, watch.channelId).catch((e) => logger.error("watch", "Tick failed", e));
  };

  safeTick();
  timers.set(watch.channelId, setInterval(safeTick, intervalMs));
  logger.info(
    "watch",
    `Watching ${watch.repo} every ${watch.intervalMinutes} min → channel ${watch.channelId}`
  );
}

export function stopWatch(channelId: string): void {
  const t = timers.get(channelId);
  if (t) {
    clearInterval(t);
    timers.delete(channelId);
  }
}

export function isWatching(channelId: string): boolean {
  return timers.has(channelId);
}

/** Bot 啟動時：把 db 裡尚未完成的 watch 全部接回來 */
export async function restoreWatchers(client: Client): Promise<void> {
  if (!config.watch.enabled) {
    logger.info("watch", "Repo watcher disabled (WATCH_ENABLED=false)");
    return;
  }
  const watches = await listRepoWatches();
  const active = watches.filter((w) => !w.doneAt);
  for (const w of active) startWatch(client, w);
  logger.info("watch", `Restored ${active.length} repo watcher(s)`);
}

export { deleteRepoWatch };
