import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { logger } from "./utils/logger";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    logger.error("config", `Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function resolvePrivateKey(value: string): string {
  if (value.startsWith("-----BEGIN")) return value;
  return fs.readFileSync(value, "utf8");
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: optional("DISCORD_GUILD_ID", ""),
  },
  github: {
    appId: required("GITHUB_APP_ID"),
    privateKey: resolvePrivateKey(required("GITHUB_APP_PRIVATE_KEY")),
    installationId: parseInt(required("GITHUB_INSTALLATION_ID"), 10),
    clientId: required("GITHUB_CLIENT_ID"),
    clientSecret: required("GITHUB_CLIENT_SECRET"),
  },
  firestore: {
    projectId: optional("FIRESTORE_PROJECT_ID", ""),
    keyFilename: optional("GOOGLE_APPLICATION_CREDENTIALS", ""),
  },
  watch: {
    enabled: optional("WATCH_ENABLED", "true") !== "false",
    repo: optional("WATCH_REPO", "hpcac/2026-APAC-HPC-AI"),
    intervalMinutes: parseInt(optional("WATCH_INTERVAL_MINUTES", "60"), 10),
    // 預設相對於程序 cwd（pm2 部署下 = ~/discord-github-bot）；Docker 部署請設成 /data/repos
    cloneDir: optional("WATCH_CLONE_DIR", "./repos"),
    notifyOnPrivate: optional("WATCH_NOTIFY_ON_PRIVATE", "true") !== "false",
  },
  // YouTube 直播即時轉錄（/live-alert）；預設值對應 stream2txt/ 目錄的標準安裝
  liveAlert: {
    python: optional("LIVE_ALERT_PYTHON", path.resolve(process.cwd(), "stream2txt/.venv/bin/python")),
    worker: optional("LIVE_ALERT_WORKER", path.resolve(process.cwd(), "stream2txt/worker.py")),
    model: optional("LIVE_ALERT_MODEL", "small"), // small 比 base 更常正確寫出 Quiz 這個字（見 README §7）
    language: optional("LIVE_ALERT_LANGUAGE", "auto"),
    refreshSeconds: parseInt(optional("LIVE_ALERT_REFRESH_SECONDS", "25"), 10),
    maxSessions: parseInt(optional("LIVE_ALERT_MAX_SESSIONS", "1"), 10), // 一次只追一個直播：轉錄吃 CPU，兩個以上會拖垮整台
    askScript: optional("LIVE_ALERT_ASK", path.resolve(process.cwd(), "stream2txt/ask_once.py")),
    // 擁有者的 Discord user ID（ask / ideas / ask-access 的管理者）；留空＝沒有人是擁有者，這些指令都用不了
    ownerId: optional("LIVE_ALERT_OWNER_ID", ""),
  },
  encryptionKey: required("ENCRYPTION_KEY"),
  server: {
    port: parseInt(optional("PORT", "3000"), 10),
    baseUrl: required("BASE_URL"),
  },
};
