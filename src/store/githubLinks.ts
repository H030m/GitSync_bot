import { db } from "./firestore";
import { encrypt, decrypt } from "../utils/crypto";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface GitHubLink {
  discordUserId: string;
  githubLogin: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  expiresAt: string;
}

const coll = () => db.collection("githubLinks");

export async function getGitHubLink(discordUserId: string): Promise<GitHubLink | null> {
  const doc = await coll().doc(discordUserId).get();
  if (!doc.exists) return null;
  return doc.data() as GitHubLink;
}

export async function setGitHubLink(link: GitHubLink): Promise<void> {
  await coll().doc(link.discordUserId).set(link);
}

export function decryptTokens(link: GitHubLink): { accessToken: string; refreshToken: string } {
  try {
    return {
      accessToken: decrypt(link.encryptedAccessToken, config.encryptionKey),
      refreshToken: decrypt(link.encryptedRefreshToken, config.encryptionKey),
    };
  } catch (e) {
    logger.error("githubLinks", "Failed to decrypt tokens", e);
    throw new Error("Token decryption failed");
  }
}
