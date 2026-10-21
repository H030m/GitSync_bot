import { loadDb, saveDb } from "./firestore";
import { SEED_TEAM_MEMBERS } from "../hpc/teamAccounts";

export interface TeamMember {
  name: string;
  hpcAccount: string;
  discordUsername?: string; // 舊資料才有；新用 /quota-add-member 加的人不需要這欄
}

// 第一次讀取時如果 store 是空的，用 teamAccounts.ts 裡原本寫死的 7 人當種子資料。
function ensureSeeded(): void {
  const db = loadDb();
  if (Object.keys(db.teamMembers).length > 0) return;
  for (const m of SEED_TEAM_MEMBERS) {
    db.teamMembers[m.hpcAccount] = m;
  }
  saveDb(db);
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  ensureSeeded();
  const db = loadDb();
  return Object.values(db.teamMembers) as TeamMember[];
}

export async function addTeamMember(hpcAccount: string, name: string): Promise<void> {
  ensureSeeded();
  const db = loadDb();
  db.teamMembers[hpcAccount] = { name, hpcAccount };
  saveDb(db);
}

export async function getTeamMember(hpcAccount: string): Promise<TeamMember | null> {
  ensureSeeded();
  const db = loadDb();
  return (db.teamMembers[hpcAccount] as TeamMember) || null;
}
