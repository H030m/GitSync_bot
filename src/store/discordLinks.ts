import { loadDb, saveDb } from "./firestore";

// hpcAccount -> Discord 數字使用者 ID（由 /link-discord 自助綁定）
export async function getDiscordId(hpcAccount: string): Promise<string | null> {
  const db = loadDb();
  return db.discordLinks[hpcAccount] || null;
}

export async function setDiscordId(hpcAccount: string, discordId: string): Promise<void> {
  const db = loadDb();
  db.discordLinks[hpcAccount] = discordId;
  saveDb(db);
}

export async function getAllDiscordLinks(): Promise<Record<string, string>> {
  const db = loadDb();
  return db.discordLinks;
}
