/**
 * YouTube 直播即時轉錄（/live-alert）的子程序管理。
 *
 * ── Worker 協定（stream2txt/worker.py 必須照此實作）──────────────────────────
 * 呼叫方式：
 *   spawn(python, ["-u", "-X", "utf8", worker,
 *                  "--url", url, "--output", <transcript 絕對路徑>,
 *                  "--max-seconds", <剩餘秒數整數>, "--model", model,
 *                  "--language", language, "--refresh-seconds", refresh],
 *         { cwd: path.dirname(worker), stdio: ["ignore", "pipe", "pipe"], env })
 *   env = process.env + PYTHONUTF8=1, PYTHONUNBUFFERED=1,
 *         HF_HOME=<workerDir>/cache/huggingface, HUGGINGFACE_HUB_CACHE=<workerDir>/models,
 *         XDG_CACHE_HOME=<workerDir>/cache, STREAM2TXT_NODE=<bot 的 node>（給 yt-dlp 當 JS runtime）, STREAM2TXT_CLAUDE=<claude CLI>
 *   不加 -I（會讓 PYTHON* 環境變數失效，也會讓 worker 無法 import 同目錄模組）；不 detached。
 *
 * stdout：每行一個 JSON 物件（非 JSON 的行忽略，只記 debug log）：
 *   {"type":"status","message":str}                      只記 log
 *   {"type":"quiz","category":str,"text":str,"stream_time":float}  發 quiz 警報（category 來自 alert.py Detector）
 *   {"type":"error","message":str}                       記 warn log
 *   {"type":"end","reason":"stream-ended"|"deadline"|"not-live"}    記住 reason；之後 worker 以 exit code 0 結束
 * worker 自己以 append 模式把逐字稿寫進 --output，bot 不處理 segment。
 * stderr 逐行記 log，並保留最後 20 行供 crash 時回報。
 * 收到 SIGTERM 時 worker 應盡快（15 秒內）收尾退出，否則 bot 會 SIGKILL。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";
import { AttachmentBuilder, Client } from "discord.js";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  LiveAlertSession,
  addSession,
  getSession,
  updateSession,
  listRunningSessions,
} from "../store/liveAlerts";

const SESSION_MS = 5 * 60 * 60 * 1000;
const ALLOWED_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const MAX_TARGETS = 25;
const QUIZ_COOLDOWN_MS = 30 * 1000; // 只防洗版；不比 alert.py 的 COOLDOWN（30s）嚴
const KILL_GRACE_MS = 15 * 1000;
const RETRY_DELAY_MS = 30 * 1000;
const MAX_RETRIES = 3;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const STDERR_KEEP = 20;
const LOG_DIR = "data/live-alerts";

interface Runtime {
  child: ChildProcess | null;
  deadlineTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  stopReason: string | null;
  endEventReason: string | null;
  stderrTail: string[];
  retries: number;
  lastQuizAt: Map<string, number>; // 依 category 各自冷卻
  finalized: boolean;
}

const runtimes = new Map<string, Runtime>();

export interface StartLiveAlertParams {
  guildId: string | null;
  channelId: string;
  url: string;
  targetsRaw: string;
  createdBy: string;
}

function validateUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("網址格式不正確，請貼 YouTube 直播網址。");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("網址格式不正確，請貼 YouTube 直播網址。");
  }
  if (!ALLOWED_HOSTS.has(u.hostname.toLowerCase())) {
    throw new Error("只支援 YouTube 網址（youtube.com／youtu.be）。");
  }
  return u.toString();
}

function parseTargets(raw: string): { userIds: string[]; roleIds: string[] } {
  const userIds = [...new Set([...raw.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]))];
  const roleIds = [...new Set([...raw.matchAll(/<@&(\d+)>/g)].map((m) => m[1]))];
  const total = userIds.length + roleIds.length;
  if (total === 0) throw new Error("請至少 @ 一個使用者或身分組作為通知對象。");
  if (total > MAX_TARGETS) throw new Error(`通知對象最多 ${MAX_TARGETS} 個。`);
  return { userIds, roleIds };
}

export async function startLiveAlert(
  client: Client,
  params: StartLiveAlertParams,
): Promise<LiveAlertSession> {
  lastClient = client;
  const url = validateUrl(params.url);
  const { userIds, roleIds } = parseTargets(params.targetsRaw);

  const running = listRunningSessions();
  if (running.length >= config.liveAlert.maxSessions) {
    const list = running.map((s) => `\`${s.id}\`（<#${s.channelId}>）`).join("、");
    throw new Error(
      `同時執行的直播轉錄已達上限（${config.liveAlert.maxSessions} 個），目前在跑：${list}。請先到該頻道 \`/live-alert stop\`。`,
    );
  }
  for (const p of [config.liveAlert.python, config.liveAlert.worker]) {
    if (!fs.existsSync(p)) throw new Error(`轉錄環境尚未安裝（找不到 ${p}）`);
  }

  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  const id = crypto.randomBytes(3).toString("hex");
  const transcriptPath = `${LOG_DIR}/${id}.txt`;
  fs.closeSync(fs.openSync(path.resolve(process.cwd(), transcriptPath), "a", 0o600));

  const now = Date.now();
  const session: LiveAlertSession = {
    id,
    guildId: params.guildId,
    channelId: params.channelId,
    url,
    userIds,
    roleIds,
    createdBy: params.createdBy,
    startedAt: new Date(now).toISOString(),
    deadline: new Date(now + SESSION_MS).toISOString(),
    status: "running",
    transcriptPath,
    quizCount: 0,
    transcriptPosted: false,
  };
  addSession(session);
  logger.info("liveAlert", `session ${id} started: ${url} (channel ${params.channelId})`);
  launch(client, session);
  return session;
}

/** 建立 runtime、設 deadline timer 並 spawn worker（start 與 restore 共用）。 */
function launch(client: Client, session: LiveAlertSession): void {
  const rt: Runtime = {
    child: null,
    deadlineTimer: null,
    killTimer: null,
    retryTimer: null,
    stopReason: null,
    endEventReason: null,
    stderrTail: [],
    retries: 0,
    lastQuizAt: new Map(),
    finalized: false,
  };
  runtimes.set(session.id, rt);
  const remainMs = new Date(session.deadline).getTime() - Date.now();
  rt.deadlineTimer = setTimeout(() => stopLiveAlert(session.id, "deadline"), Math.max(remainMs, 0));
  spawnWorker(client, session.id);
}

function spawnWorker(client: Client, id: string): void {
  const rt = runtimes.get(id);
  const session = getSession(id);
  if (!rt || !session || rt.finalized) return;

  const remainSec = Math.floor((new Date(session.deadline).getTime() - Date.now()) / 1000);
  if (remainSec <= 0) {
    void finalize(client, id, "deadline", 0);
    return;
  }

  const { python, worker, model, language, refreshSeconds } = config.liveAlert;
  const workerDir = path.dirname(worker);
  const args = [
    "-u", "-X", "utf8", worker,
    "--url", session.url,
    "--output", path.resolve(process.cwd(), session.transcriptPath),
    "--max-seconds", String(remainSec),
    "--model", model,
    "--language", language,
    "--refresh-seconds", String(refreshSeconds),
  ];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    HF_HOME: path.join(workerDir, "cache", "huggingface"),
    HUGGINGFACE_HUB_CACHE: path.join(workerDir, "models"),
    XDG_CACHE_HOME: path.join(workerDir, "cache"),
    STREAM2TXT_NODE: process.execPath,
    // 第二關 LLM 判斷（worker 的 llm_loop）用；systemd 的 PATH 沒有 nvm，claude 與 bot 的 node 同一個 bin
    STREAM2TXT_CLAUDE: path.join(path.dirname(process.execPath), "claude"),
  };

  rt.stderrTail = [];
  rt.endEventReason = null;
  let child: ChildProcess;
  try {
    child = spawn(python, args, { cwd: workerDir, stdio: ["ignore", "pipe", "pipe"], env });
  } catch (e) {
    logger.error("liveAlert", `session ${id} spawn threw`, e);
    rt.stderrTail.push(String((e as Error)?.message ?? e));
    void handleExit(client, id, 1, null);
    return;
  }
  rt.child = child;
  logger.info("liveAlert", `session ${id} worker spawned (pid ${child.pid}, max-seconds ${remainSec})`);

  readline.createInterface({ input: child.stdout! }).on("line", (line) => {
    handleStdoutLine(client, id, line).catch((e) => logger.error("liveAlert", `session ${id} stdout handler`, e));
  });
  readline.createInterface({ input: child.stderr! }).on("line", (line) => {
    logger.info("liveAlert", `session ${id} stderr: ${line}`);
    rt.stderrTail.push(line);
    if (rt.stderrTail.length > STDERR_KEEP) rt.stderrTail.shift();
  });

  let exited = false;
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (exited) return;
    exited = true;
    handleExit(client, id, code, signal).catch((e) => logger.error("liveAlert", `session ${id} exit handler`, e));
  };
  child.on("error", (e) => {
    logger.error("liveAlert", `session ${id} child error`, e);
    rt.stderrTail.push(String(e.message));
    onExit(1, null);
  });
  // 用 close 而非 exit：close 在 stdout/stderr 都讀完後才觸發，end 事件與最後的 quiz 不會漏
  child.on("close", onExit);
}

async function handleStdoutLine(client: Client, id: string, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    logger.info("liveAlert", `session ${id} non-JSON stdout (debug): ${trimmed.slice(0, 200)}`);
    return;
  }
  if (!msg || typeof msg !== "object") return;
  const rt = runtimes.get(id);
  if (!rt) return;
  switch (msg.type) {
    case "status":
      logger.info("liveAlert", `session ${id} status: ${msg.message}`);
      break;
    case "error":
      logger.warn("liveAlert", `session ${id} worker error: ${msg.message}`);
      break;
    case "end":
      rt.endEventReason = typeof msg.reason === "string" ? msg.reason : null;
      logger.info("liveAlert", `session ${id} end event: ${msg.reason}`);
      break;
    case "quiz":
      await sendQuizAlert(client, id, String(msg.category ?? "考試"), String(msg.text ?? ""), msg.stream_time);
      break;
    default:
      logger.info("liveAlert", `session ${id} unknown message type (debug): ${String(msg.type)}`);
  }
}

async function sendQuizAlert(client: Client, id: string, category: string, text: string, streamTime: unknown): Promise<void> {
  const rt = runtimes.get(id);
  const session = getSession(id);
  if (!rt || !session || session.status !== "running") return;

  const now = Date.now();
  const key = category.split("（")[0]; // 「疑似 Quiz（3分：…）」每次分數不同，冷卻以類別名為準
  if (now - (rt.lastQuizAt.get(key) ?? 0) < QUIZ_COOLDOWN_MS) {
    logger.info("liveAlert", `session ${id} quiz suppressed (cooldown ${key}): ${text.slice(0, 80)}`);
    return;
  }
  rt.lastQuizAt.set(key, now);

  try {
    const channel = await client.channels.fetch(session.channelId);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      logger.warn("liveAlert", `session ${id} channel ${session.channelId} cannot send`);
      return;
    }
    const mentions = [
      ...session.userIds.map((u) => `<@${u}>`),
      ...session.roleIds.map((r) => `<@&${r}>`),
    ].join(" ");
    const snippet = text.length > 300 ? text.slice(0, 300) + "…" : text;
    await channel.send({
      content:
        `🚨 ${mentions} 直播偵測到：**${category}**\n` +
        `> ${snippet.replace(/\n/g, "\n> ")}\n` +
        `${session.url}\n` +
        `工作 ID：\`${id}\``,
      allowedMentions: { users: session.userIds, roles: session.roleIds },
    });
    updateSession(id, { quizCount: (getSession(id)?.quizCount ?? session.quizCount) + 1 });
    logger.info("liveAlert", `session ${id} quiz alert sent (stream_time ${String(streamTime)})`);
  } catch (e) {
    logger.error("liveAlert", `session ${id} failed to send quiz alert`, e);
  }
}

async function handleExit(
  client: Client,
  id: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  const rt = runtimes.get(id);
  if (!rt || rt.finalized) return;
  rt.child = null;
  if (rt.killTimer) {
    clearTimeout(rt.killTimer);
    rt.killTimer = null;
  }
  logger.info("liveAlert", `session ${id} worker exited (code ${code}, signal ${signal})`);

  if (rt.stopReason) {
    await finalize(client, id, rt.stopReason, code);
    return;
  }
  if (code === 0) {
    await finalize(client, id, rt.endEventReason || "stream-ended", code);
    return;
  }
  const session = getSession(id);
  const pastDeadline = !session || new Date(session.deadline).getTime() <= Date.now();
  if (pastDeadline) {
    await finalize(client, id, "deadline", code);
    return;
  }
  if (rt.retries >= MAX_RETRIES) {
    await finalize(client, id, "error", code);
    return;
  }
  rt.retries += 1;
  logger.warn("liveAlert", `session ${id} crashed, retry ${rt.retries}/${MAX_RETRIES} in ${RETRY_DELAY_MS / 1000}s`);
  rt.retryTimer = setTimeout(() => {
    rt.retryTimer = null;
    spawnWorker(client, id);
  }, RETRY_DELAY_MS);
}

/** 要求停止：SIGTERM，15 秒後還沒結束就 SIGKILL。finalize 由 exit 事件處理。 */
export function stopLiveAlert(id: string, reason: string): boolean {
  const rt = runtimes.get(id);
  if (!rt || rt.finalized) return false;
  if (!rt.stopReason) rt.stopReason = reason;
  if (rt.deadlineTimer) {
    clearTimeout(rt.deadlineTimer);
    rt.deadlineTimer = null;
  }
  if (rt.retryTimer) {
    // 正在等重試、沒有子程序：直接結束
    clearTimeout(rt.retryTimer);
    rt.retryTimer = null;
    rt.child = null;
    // client 由 finalize 時的全域參考提供
    if (lastClient) void finalize(lastClient, id, rt.stopReason, null);
    return true;
  }
  const child = rt.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGTERM");
    } catch (e) {
      logger.warn("liveAlert", `session ${id} SIGTERM failed: ${(e as Error).message}`);
    }
    if (!rt.killTimer) {
      rt.killTimer = setTimeout(() => {
        try {
          if (rt.child && rt.child.exitCode === null && rt.child.signalCode === null) {
            logger.warn("liveAlert", `session ${id} still alive after grace, SIGKILL`);
            rt.child.kill("SIGKILL");
          }
        } catch (e) {
          logger.warn("liveAlert", `session ${id} SIGKILL failed: ${(e as Error).message}`);
        }
      }, KILL_GRACE_MS);
    }
  }
  return true;
}

let lastClient: Client | null = null;

function describeReason(reason: string): string {
  switch (reason) {
    case "deadline": return "已達 5 小時上限，自動關閉";
    case "manual": return "已手動停止";
    case "stream-ended": return "直播已結束";
    case "not-live": return "這不是正在進行的直播（是已結束的直播錄影或一般影片），請貼目前正在直播的網址";
    case "error": return "轉錄程序異常中止";
    case "expired-while-offline": return "bot 離線期間已超過 5 小時上限";
    default: return reason;
  }
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} 小時 ${m} 分鐘` : `${m} 分鐘`;
}

async function finalize(client: Client, id: string, reason: string, exitCode: number | null): Promise<void> {
  const rt = runtimes.get(id);
  if (rt) {
    if (rt.finalized) return;
    rt.finalized = true;
    for (const t of [rt.deadlineTimer, rt.killTimer, rt.retryTimer]) if (t) clearTimeout(t);
    rt.deadlineTimer = rt.killTimer = rt.retryTimer = null;
  }
  const stderrTail = rt ? [...rt.stderrTail] : [];
  runtimes.delete(id);

  try {
    const before = getSession(id);
    if (!before) return;
    const endedAt = new Date().toISOString();
    const session = updateSession(id, { status: "done", endedAt, endReason: reason }) ?? before;
    logger.info("liveAlert", `session ${id} finalized: ${reason} (exit ${exitCode})`);

    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      logger.warn("liveAlert", `session ${id} finalize: channel unavailable`);
      return;
    }

    const durationMs = new Date(endedAt).getTime() - new Date(session.startedAt).getTime();
    let content =
      `🏁 直播轉錄工作 \`${id}\` 已結束：${describeReason(reason)}\n` +
      `• 考試警報：${session.quizCount} 次\n` +
      `• 持續時間：${formatDuration(durationMs)}`;
    if (reason === "error" && stderrTail.length > 0) {
      const tail = stderrTail.join("\n").slice(-1500);
      content += `\n最後的錯誤輸出：\n\`\`\`\n${tail.replace(/```/g, "'''")}\n\`\`\``;
    }

    const abs = path.resolve(process.cwd(), session.transcriptPath);
    let file: AttachmentBuilder | null = null;
    if (!session.transcriptPosted) {
      let size = -1;
      try {
        size = fs.statSync(abs).size;
      } catch {
        size = -1;
      }
      if (size === 0) {
        content += "\n逐字稿是空的（沒有轉錄內容）。";
      } else if (size > MAX_UPLOAD_BYTES) {
        content += `\n逐字稿超過 8 MB 無法上傳，檔案留在 bot 主機：\`${session.transcriptPath}\`。`;
      } else if (size > 0) {
        file = new AttachmentBuilder(abs, { name: `transcript-${id}.txt` });
      } else {
        content += "\n找不到逐字稿檔案。";
      }
    }

    try {
      await channel.send({
        content,
        files: file ? [file] : [],
        allowedMentions: { parse: [] },
      });
      if (file) updateSession(id, { transcriptPosted: true });
    } catch (e) {
      logger.error("liveAlert", `session ${id} failed to post end message/transcript`, e);
    }
  } catch (e) {
    logger.error("liveAlert", `session ${id} finalize failed`, e);
  }
}

const ASK_TIMEOUT_MS = 120 * 1000;

/** 用 stream2txt/ask_once.py（upstream ask.py 的 ask()）根據逐字稿回答題目。 */
export function askFromTranscript(session: LiveAlertSession, question: string, extraArgs: string[] = []): Promise<string> {
  const { python, askScript } = config.liveAlert;
  const abs = path.resolve(process.cwd(), session.transcriptPath);
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) {
      reject(new Error("這個工作的逐字稿還是空的，等轉錄出一些內容再問。"));
      return;
    }
    const child = spawn(python, ["-X", "utf8", askScript, abs, ...extraArgs], {
      cwd: path.dirname(askScript),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        // systemd 的 PATH 沒有 nvm；claude 跟 bot 的 node 在同一個 bin
        STREAM2TXT_CLAUDE: path.join(path.dirname(process.execPath), "claude"),
      },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`回答逾時（${ASK_TIMEOUT_MS / 1000} 秒）`));
    }, ASK_TIMEOUT_MS);
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error((out.trim() || err.trim() || `ask 結束碼 ${code}`).slice(-500)));
    });
    child.stdin!.end(question);
  });
}

/** bot 啟動時：對每個 running session 重新 spawn，或（已過期）直接收尾。 */
export async function restoreLiveAlerts(client: Client): Promise<void> {
  lastClient = client;
  const running = listRunningSessions();
  for (const s of running) {
    try {
      if (runtimes.has(s.id)) continue;
      if (new Date(s.deadline).getTime() <= Date.now()) {
        runtimes.set(s.id, {
          child: null, deadlineTimer: null, killTimer: null, retryTimer: null,
          stopReason: null, endEventReason: null, stderrTail: [], retries: 0, lastQuizAt: new Map(), finalized: false,
        });
        await finalize(client, s.id, "expired-while-offline", null);
        continue;
      }
      logger.info("liveAlert", `restoring session ${s.id}`);
      launch(client, s);
    } catch (e) {
      logger.error("liveAlert", `restore session ${s.id} failed`, e);
    }
  }
  logger.info("liveAlert", `restored ${running.length} running session(s)`);
}

/** 同步殺掉所有子程序（掛在 process exit，避免 bot 結束後留下孤兒 worker）。 */
export function killAllLiveWorkers(): void {
  for (const rt of runtimes.values()) {
    try {
      rt.child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

process.on("exit", killAllLiveWorkers);
