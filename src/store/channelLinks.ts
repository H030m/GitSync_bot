import { loadDb, saveDb } from "./firestore";
import { logger } from "../utils/logger";

export interface StatusFieldOption {
  id: string;
  name: string;
}

export interface StatusField {
  id: string;
  name: string;
  options: StatusFieldOption[];
}

export interface ChannelLink {
  channelId: string;
  guildId: string;
  repoOwner: string;
  repoName: string;
  projectOwner?: string;
  projectNumber?: number;
  projectId?: string;
  statusField?: StatusField;
  issuePrefix?: string;
}

export async function getChannelLink(channelId: string): Promise<ChannelLink | null> {
  const db = loadDb();
  return db.channelLinks[channelId] || null;
}

export async function setChannelLink(link: ChannelLink): Promise<void> {
  const db = loadDb();
  db.channelLinks[link.channelId] = link;
  saveDb(db);
}

export async function deleteChannelLink(channelId: string): Promise<void> {
  const db = loadDb();
  delete db.channelLinks[channelId];
  saveDb(db);
}

export async function getChannelLinkByThread(
  parentChannelId: string,
): Promise<ChannelLink | null> {
  return getChannelLink(parentChannelId);
}

export async function getChannelLinksByRepo(
  repoOwner: string,
  repoName: string,
): Promise<ChannelLink[]> {
  try {
    const db = loadDb();
    const links = Object.values(db.channelLinks) as ChannelLink[];
    return links.filter(
      (l) => l.repoOwner.toLowerCase() === repoOwner.toLowerCase() && l.repoName.toLowerCase() === repoName.toLowerCase(),
    );
  } catch (e) {
    logger.error("channelLinks", `Failed to get channel links for ${repoOwner}/${repoName}`, e);
    return [];
  }
}

