import { loadDb, saveDb } from "./firestore";

export interface AlertChannelConfig {
  channelId: string;
  thresholdTwd: number;
  enabledAt: string;
}

export async function addDailyChannel(channelId: string, guildId: string): Promise<void> {
  const db = loadDb();
  db.quotaDailyChannels[channelId] = { channelId, guildId, enabledAt: new Date().toISOString() };
  saveDb(db);
}

export async function removeDailyChannel(channelId: string): Promise<void> {
  const db = loadDb();
  delete db.quotaDailyChannels[channelId];
  saveDb(db);
}

export async function getDailyChannelIds(): Promise<string[]> {
  const db = loadDb();
  return Object.keys(db.quotaDailyChannels);
}

export async function isDailyChannel(channelId: string): Promise<boolean> {
  const db = loadDb();
  return Boolean(db.quotaDailyChannels[channelId]);
}

export async function addAlertChannel(
  channelId: string,
  guildId: string,
  thresholdTwd: number,
): Promise<void> {
  const db = loadDb();
  db.quotaAlertChannels[channelId] = {
    channelId,
    guildId,
    thresholdTwd,
    enabledAt: new Date().toISOString(),
  } as AlertChannelConfig;
  saveDb(db);
}

export async function removeAlertChannel(channelId: string): Promise<void> {
  const db = loadDb();
  delete db.quotaAlertChannels[channelId];
  saveDb(db);
}

export async function getAlertChannels(): Promise<AlertChannelConfig[]> {
  const db = loadDb();
  return Object.values(db.quotaAlertChannels) as AlertChannelConfig[];
}

export async function getAlertChannel(channelId: string): Promise<AlertChannelConfig | null> {
  const db = loadDb();
  return (db.quotaAlertChannels[channelId] as AlertChannelConfig) || null;
}
