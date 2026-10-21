import { loadDb, saveDb } from "./firestore";

export interface ThreadIssue {
  threadId: string;
  channelId: string;
  issueNumber: number;
  issueNodeId: string;
  projectItemId: string;
  repoOwner: string;
  repoName: string;
}

export async function getThreadIssue(threadId: string): Promise<ThreadIssue | null> {
  const db = loadDb();
  return db.threadIssues[threadId] || null;
}

export async function setThreadIssue(entry: ThreadIssue): Promise<void> {
  const db = loadDb();
  // Remove any stale thread mappings for the same repo and issue number
  for (const tid of Object.keys(db.threadIssues)) {
    const item = db.threadIssues[tid];
    if (
      item.repoOwner.toLowerCase() === entry.repoOwner.toLowerCase() &&
      item.repoName.toLowerCase() === entry.repoName.toLowerCase() &&
      item.issueNumber === entry.issueNumber
    ) {
      delete db.threadIssues[tid];
    }
  }
  db.threadIssues[entry.threadId] = entry;
  saveDb(db);
}

export async function getThreadIssueByNumber(
  repoOwner: string,
  repoName: string,
  issueNumber: number,
): Promise<ThreadIssue | null> {
  const db = loadDb();
  const issues = Object.values(db.threadIssues) as ThreadIssue[];
  return (
    issues.find(
      (i) =>
        i.repoOwner.toLowerCase() === repoOwner.toLowerCase() &&
        i.repoName.toLowerCase() === repoName.toLowerCase() &&
        i.issueNumber === issueNumber,
    ) || null
  );
}

