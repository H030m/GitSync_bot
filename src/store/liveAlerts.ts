import { loadDb, saveDb } from "./firestore";

export interface LiveAlertSession {
  id: string;
  guildId: string | null;
  channelId: string;
  url: string;
  userIds: string[];
  roleIds: string[];
  createdBy: string;
  startedAt: string;
  deadline: string;
  status: "running" | "done";
  endedAt?: string;
  endReason?: string;
  transcriptPath: string;
  quizCount: number;
  transcriptPosted: boolean;
}

export function addSession(session: LiveAlertSession): void {
  const db = loadDb();
  db.liveAlerts[session.id] = session;
  saveDb(db);
}

export function getSession(id: string): LiveAlertSession | null {
  const db = loadDb();
  return (db.liveAlerts[id] as LiveAlertSession) || null;
}

export function updateSession(id: string, patch: Partial<LiveAlertSession>): LiveAlertSession | null {
  const db = loadDb();
  const cur = db.liveAlerts[id] as LiveAlertSession | undefined;
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db.liveAlerts[id] = next;
  saveDb(db);
  return next;
}

export function listSessions(): LiveAlertSession[] {
  const db = loadDb();
  return Object.values(db.liveAlerts) as LiveAlertSession[];
}

export function listRunningSessions(): LiveAlertSession[] {
  return listSessions().filter((s) => s.status === "running");
}

export function listChannelSessions(channelId: string, onlyRunning: boolean): LiveAlertSession[] {
  return listSessions().filter(
    (s) => s.channelId === channelId && (!onlyRunning || s.status === "running"),
  );
}
