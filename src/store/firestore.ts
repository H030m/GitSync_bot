import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.resolve(DATA_DIR, "db.json");

export interface DbSchema {
  channelLinks: Record<string, any>;
  threadIssues: Record<string, any>;
  githubLinks: Record<string, any>;
  repoWatches: Record<string, any>;
  quotaDailyChannels: Record<string, any>;
  quotaAlertChannels: Record<string, any>;
  discordLinks: Record<string, any>;
  quotaAlertNotified: Record<string, any>;
  teamMembers: Record<string, any>;
}

function emptyDb(): DbSchema {
  return {
    channelLinks: {},
    threadIssues: {},
    githubLinks: {},
    repoWatches: {},
    quotaDailyChannels: {},
    quotaAlertChannels: {},
    discordLinks: {},
    quotaAlertNotified: {},
    teamMembers: {},
  };
}

export function loadDb(): DbSchema {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = emptyDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const content = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(content);
    const fallback = emptyDb();
    return {
      channelLinks: parsed.channelLinks || fallback.channelLinks,
      threadIssues: parsed.threadIssues || fallback.threadIssues,
      githubLinks: parsed.githubLinks || fallback.githubLinks,
      repoWatches: parsed.repoWatches || fallback.repoWatches,
      quotaDailyChannels: parsed.quotaDailyChannels || fallback.quotaDailyChannels,
      quotaAlertChannels: parsed.quotaAlertChannels || fallback.quotaAlertChannels,
      discordLinks: parsed.discordLinks || fallback.discordLinks,
      quotaAlertNotified: parsed.quotaAlertNotified || fallback.quotaAlertNotified,
      teamMembers: parsed.teamMembers || fallback.teamMembers,
    };
  } catch (e) {
    logger.error("localDb", "Error loading db, using fallback", e);
    return emptyDb();
  }
}

export function saveDb(data: DbSchema): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    logger.error("localDb", "Error saving db", e);
  }
}
