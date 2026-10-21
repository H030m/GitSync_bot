import dotenv from "dotenv";
import fs from "fs";
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
  encryptionKey: required("ENCRYPTION_KEY"),
  server: {
    port: parseInt(optional("PORT", "3000"), 10),
    baseUrl: required("BASE_URL"),
  },
};
