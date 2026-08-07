import { db } from "./firestore";

export interface ThreadIssue {
  threadId: string;
  channelId: string;
  issueNumber: number;
  issueNodeId: string;
  projectItemId: string;
  repoOwner: string;
  repoName: string;
}

const coll = () => db.collection("threadIssues");

export async function getThreadIssue(threadId: string): Promise<ThreadIssue | null> {
  const doc = await coll().doc(threadId).get();
  if (!doc.exists) return null;
  return doc.data() as ThreadIssue;
}

export async function setThreadIssue(entry: ThreadIssue): Promise<void> {
  await coll().doc(entry.threadId).set(entry);
}
