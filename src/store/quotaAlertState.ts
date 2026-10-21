import { loadDb, saveDb } from "./firestore";

// 記錄「今天」這個頻道對這個人已經提醒過，避免每 15 分鐘重複 @。
// db.quotaAlertNotified[channelId][date][hpcAccount] = true
export async function hasNotifiedToday(
  channelId: string,
  date: string,
  hpcAccount: string,
): Promise<boolean> {
  const db = loadDb();
  return Boolean(db.quotaAlertNotified?.[channelId]?.[date]?.[hpcAccount]);
}

export async function markNotified(channelId: string, date: string, hpcAccount: string): Promise<void> {
  const db = loadDb();
  if (!db.quotaAlertNotified) db.quotaAlertNotified = {};
  if (!db.quotaAlertNotified[channelId]) db.quotaAlertNotified[channelId] = {};
  if (!db.quotaAlertNotified[channelId][date]) db.quotaAlertNotified[channelId][date] = {};
  db.quotaAlertNotified[channelId][date][hpcAccount] = true;
  saveDb(db);
}
