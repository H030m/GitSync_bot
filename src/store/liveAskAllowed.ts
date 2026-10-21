import { loadDb, saveDb } from "./firestore";

/** 被允許使用 /live-alert ask、/live-alert ideas 的人（擁有者不在此名單）；從新增起這麼久後自動失效。 */
export const ASK_ACCESS_MS = 5 * 60 * 60 * 1000;

export type AskScope = "ask" | "ideas";
export const ALL_SCOPES: AskScope[] = ["ask", "ideas"];

export interface LiveAskAllowed {
  addedBy: string;
  addedAt: string;
  expiresAt: string;
  /** 沒有這個欄位的舊紀錄視為兩個都可以 */
  scopes?: AskScope[];
}

function alive(e: LiveAskAllowed | undefined): boolean {
  return !!e && new Date(e.expiresAt).getTime() > Date.now();
}

function scopesOf(e: LiveAskAllowed): AskScope[] {
  return e.scopes && e.scopes.length ? e.scopes : ALL_SCOPES;
}

export function isAskAllowed(userId: string, scope: AskScope): boolean {
  const e = loadDb().liveAskAllowed[userId] as LiveAskAllowed | undefined;
  return alive(e) && scopesOf(e!).includes(scope);
}

/** 新增權限；已在名單內則合併權限並重新計 5 小時。回傳到期時間（ISO）與目前權限。 */
export function addAskAllowed(userId: string, addedBy: string, scopes: AskScope[]): { expiresAt: string; scopes: AskScope[] } {
  const db = loadDb();
  const now = Date.now();
  const prev = db.liveAskAllowed[userId] as LiveAskAllowed | undefined;
  const merged = Array.from(new Set([...(alive(prev) ? scopesOf(prev!) : []), ...scopes])) as AskScope[];
  const entry: LiveAskAllowed = {
    addedBy,
    addedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ASK_ACCESS_MS).toISOString(),
    scopes: merged,
  };
  db.liveAskAllowed[userId] = entry;
  saveDb(db);
  return { expiresAt: entry.expiresAt, scopes: merged };
}

/** 移除指定權限；全部移完（或沒指定）就整筆刪除。回傳剩下的權限，沒有這個人則回傳 null。 */
export function removeAskAllowed(userId: string, scopes: AskScope[] = ALL_SCOPES): AskScope[] | null {
  const db = loadDb();
  const prev = db.liveAskAllowed[userId] as LiveAskAllowed | undefined;
  if (!prev) return null;
  const left = alive(prev) ? scopesOf(prev).filter((s) => !scopes.includes(s)) : [];
  if (left.length) db.liveAskAllowed[userId] = { ...prev, scopes: left };
  else delete db.liveAskAllowed[userId];
  saveDb(db);
  return left;
}

/** 列出尚未到期的人，並順手清掉已到期的紀錄。 */
export function listAskAllowed(): { userId: string; expiresAt: string; scopes: AskScope[] }[] {
  const db = loadDb();
  let dirty = false;
  const out: { userId: string; expiresAt: string; scopes: AskScope[] }[] = [];
  for (const [userId, e] of Object.entries<LiveAskAllowed>(db.liveAskAllowed)) {
    if (alive(e)) out.push({ userId, expiresAt: e.expiresAt, scopes: scopesOf(e) });
    else {
      delete db.liveAskAllowed[userId];
      dirty = true;
    }
  }
  if (dirty) saveDb(db);
  return out;
}
