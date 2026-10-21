import { loadDb, saveDb } from "./firestore";

export interface RepoWatch {
  /** 發指令的頻道；通知就發在這裡 */
  channelId: string;
  guildId: string;
  /** owner/name */
  repo: string;
  intervalMinutes: number;
  /** 每次掃到仍是 private 時是否也回報一則 */
  notifyOnPrivate: boolean;
  createdBy: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastStatus?: "public" | "private" | "unknown" | "error";
  /** 已公開並處理完（clone 過），watcher 不再啟動 */
  doneAt?: string;
}

export async function getRepoWatch(channelId: string): Promise<RepoWatch | null> {
  const db = loadDb();
  return (db.repoWatches[channelId] as RepoWatch) || null;
}

export async function setRepoWatch(watch: RepoWatch): Promise<void> {
  const db = loadDb();
  db.repoWatches[watch.channelId] = watch;
  saveDb(db);
}

export async function deleteRepoWatch(channelId: string): Promise<void> {
  const db = loadDb();
  delete db.repoWatches[channelId];
  saveDb(db);
}

export async function listRepoWatches(): Promise<RepoWatch[]> {
  const db = loadDb();
  return Object.values(db.repoWatches) as RepoWatch[];
}
