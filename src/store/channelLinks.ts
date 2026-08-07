import { db } from "./firestore";
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
  projectOwner: string;
  projectNumber: number;
  projectId: string;
  statusField: StatusField;
}

const coll = () => db.collection("channelLinks");

export async function getChannelLink(channelId: string): Promise<ChannelLink | null> {
  const doc = await coll().doc(channelId).get();
  if (!doc.exists) return null;
  return doc.data() as ChannelLink;
}

export async function setChannelLink(link: ChannelLink): Promise<void> {
  await coll().doc(link.channelId).set(link);
}

export async function deleteChannelLink(channelId: string): Promise<void> {
  await coll().doc(channelId).delete();
}

export async function getChannelLinkByThread(
  parentChannelId: string,
): Promise<ChannelLink | null> {
  return getChannelLink(parentChannelId);
}
