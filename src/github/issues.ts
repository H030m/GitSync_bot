import { Octokit } from "@octokit/core";
import { getInstallationOctokit } from "./app";
import { getGitHubLink, decryptTokens } from "../store/githubLinks";
import { refreshUserToken } from "./oauth";
import { encrypt } from "../utils/crypto";
import { config } from "../config";
import { setGitHubLink } from "../store/githubLinks";
import { logger } from "../utils/logger";

interface OctokitWithToken {
  octokit: Octokit;
  token: string;
}

async function getUserOctokit(discordUserId: string): Promise<OctokitWithToken | null> {
  const link = await getGitHubLink(discordUserId);
  if (!link) return null;
  const tokens = decryptTokens(link);
  const expiresAt = new Date(link.expiresAt).getTime();
  if (Date.now() > expiresAt - 300_000) {
    try {
      const refreshed = await refreshUserToken(tokens.refreshToken);
      const newLink = {
        ...link,
        encryptedAccessToken: encrypt(refreshed.access_token, config.encryptionKey),
        encryptedRefreshToken: encrypt(refreshed.refresh_token, config.encryptionKey),
        expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
      await setGitHubLink(newLink);
      return { octokit: new Octokit({ auth: refreshed.access_token }), token: refreshed.access_token };
    } catch (e) {
      logger.error("issues", `Token refresh failed for ${discordUserId}`, e);
      return null;
    }
  }
  return { octokit: new Octokit({ auth: tokens.accessToken }), token: tokens.accessToken };
}

async function getEffectiveOctokit(
  discordUserId: string,
  discordUsername: string,
): Promise<{ octokit: Octokit; usedUserToken: boolean }> {
  const user = await getUserOctokit(discordUserId);
  if (user) return { octokit: user.octokit, usedUserToken: true };
  const appOctokit = await getInstallationOctokit();
  return { octokit: appOctokit, usedUserToken: false };
}

export interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
}

export interface CreateIssueResult {
  number: number;
  nodeId: string;
  htmlUrl: string;
}

export async function createIssue(
  input: CreateIssueInput,
  discordUserId: string,
  discordUsername: string,
): Promise<CreateIssueResult> {
  const { octokit, usedUserToken } = await getEffectiveOctokit(discordUserId, discordUsername);
  let body = input.body;
  if (!usedUserToken) {
    body = `_Opened via Discord by @${discordUsername}_\n\n${body}`;
  }
  const res = await octokit.request("POST /repos/{owner}/{repo}/issues", {
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    body,
  });
  return {
    number: res.data.number,
    nodeId: res.data.node_id,
    htmlUrl: res.data.html_url,
  };
}

export async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  discordUserId: string,
  discordUsername: string,
): Promise<void> {
  const { octokit, usedUserToken } = await getEffectiveOctokit(discordUserId, discordUsername);
  let finalBody = body;
  if (!usedUserToken) {
    finalBody = `${body}\n\n_— @${discordUsername} via Discord_`;
  }
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner,
    repo,
    issue_number: issueNumber,
    body: finalBody,
  });
}

export async function setIssueAssignees(
  owner: string,
  repo: string,
  issueNumber: number,
  assignees: string[],
): Promise<void> {
  const octokit = await getInstallationOctokit();
  await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
    owner,
    repo,
    issue_number: issueNumber,
    assignees,
  });
}

export async function getIssueAssignees(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string[]> {
  const octokit = await getInstallationOctokit();
  const res = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
    owner,
    repo,
    issue_number: issueNumber,
  });
  return (res.data.assignees ?? []).map((a: { login: string }) => a.login);
}
