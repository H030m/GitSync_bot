import { loadDb, saveDb } from "./firestore";
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

export async function getGitHubLink(discordUserId: string): Promise<GitHubLink | null> {
  const db = loadDb();
  return db.githubLinks[discordUserId] || null;
}

export async function setGitHubLink(link: GitHubLink): Promise<void> {
  const db = loadDb();
  db.githubLinks[link.discordUserId] = link;
  saveDb(db);
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

export async function getDiscordUserByGitHub(githubLogin: string): Promise<string | null> {
  try {
    const db = loadDb();
    const links = Object.values(db.githubLinks) as GitHubLink[];
    const found = links.find((l) => l.githubLogin.toLowerCase() === githubLogin.toLowerCase());
    return found ? found.discordUserId : null;
  } catch (e) {
    logger.error("githubLinks", `Failed to get Discord user for GitHub login ${githubLogin}`, e);
    return null;
  }
}

