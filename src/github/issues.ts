import type { Octokit } from "@octokit/core";
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

export async function getUserOctokit(discordUserId: string): Promise<OctokitWithToken | null> {
  const link = await getGitHubLink(discordUserId);
  if (!link) return null;
  const tokens = decryptTokens(link);
  const { Octokit } = await (Function('return import("@octokit/core")')() as Promise<typeof import("@octokit/core")>);

  if (link.expiresAt && tokens.refreshToken) {
    const expiresAt = new Date(link.expiresAt).getTime();
    if (!isNaN(expiresAt) && Date.now() > expiresAt - 300_000) {
      try {
        const refreshed = await refreshUserToken(tokens.refreshToken);
        const expiresInMs = refreshed.expires_in ? refreshed.expires_in * 1000 : 365 * 24 * 3600 * 1000;
        const newLink = {
          ...link,
          encryptedAccessToken: encrypt(refreshed.access_token, config.encryptionKey),
          encryptedRefreshToken: encrypt(refreshed.refresh_token || tokens.refreshToken, config.encryptionKey),
          expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
        };
        await setGitHubLink(newLink);
        return { octokit: new Octokit({ auth: refreshed.access_token }), token: refreshed.access_token };
      } catch (e) {
        logger.error("issues", `Token refresh failed for ${discordUserId}, using existing token`, e);
      }
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
  const userTag = discordUserId ? `<@${discordUserId}> (${discordUsername})` : `@${discordUsername}`;
  const user = await getUserOctokit(discordUserId);

  if (user) {
    try {
      const res = await user.octokit.request("POST /repos/{owner}/{repo}/issues", {
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        body: input.body,
      });
      return {
        number: res.data.number,
        nodeId: res.data.node_id,
        htmlUrl: res.data.html_url,
      };
    } catch (e: any) {
      logger.warn("issues", `User token failed for createIssue (${e.status || e.message}), falling back to App token`);
    }
  }

  const appOctokit = await getInstallationOctokit();
  const body = `_Opened via Discord by ${userTag}_\n\n${input.body}`;
  const res = await appOctokit.request("POST /repos/{owner}/{repo}/issues", {
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

const recentDiscordCommentIds = new Set<number>();

export function isRecentDiscordCommentId(commentId: number): boolean {
  return recentDiscordCommentIds.has(commentId);
}

export async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  discordUserId: string,
  discordUsername: string,
): Promise<void> {
  const userTag = discordUserId ? `<@${discordUserId}> (${discordUsername})` : `@${discordUsername}`;
  const finalBody = `${body}\n\n_— ${userTag} via Discord_`;

  const user = await getUserOctokit(discordUserId);
  if (user) {
    try {
      const res = await user.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo,
        issue_number: issueNumber,
        body: finalBody,
      });
      if (res.data?.id) {
        recentDiscordCommentIds.add(res.data.id);
        setTimeout(() => recentDiscordCommentIds.delete(res.data.id), 120_000);
      }
      return;
    } catch (e: any) {
      logger.warn("issues", `User token failed for addIssueComment (${e.status || e.message}), falling back to App token`);
    }
  }

  const appOctokit = await getInstallationOctokit();
  const res = await appOctokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner,
    repo,
    issue_number: issueNumber,
    body: finalBody,
  });
  if (res.data?.id) {
    recentDiscordCommentIds.add(res.data.id);
    setTimeout(() => recentDiscordCommentIds.delete(res.data.id), 120_000);
  }
}

async function requestWithUserFallback<T>(
  discordUserId: string | undefined,
  fn: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  if (discordUserId) {
    const user = await getUserOctokit(discordUserId);
    if (user) {
      try {
        return await fn(user.octokit);
      } catch (e: any) {
        logger.warn("issues", `User token request failed (${e.status || e.message}), falling back to App token`);
      }
    }
  }
  const appOctokit = await getInstallationOctokit();
  return await fn(appOctokit);
}

export async function addIssueAssignee(
  owner: string,
  repo: string,
  issueNumber: number,
  assignee: string,
  discordUserId?: string,
): Promise<void> {
  logger.info(
    "DEBUG_ASSIGN",
    `[START] Attempting assign for ${owner}/${repo} issue #${issueNumber} -> assignee: ${assignee}, discordUserId: ${discordUserId}`
  );

  if (discordUserId) {
    const user = await getUserOctokit(discordUserId);
    if (user) {
      try {
        logger.info("DEBUG_ASSIGN", `[USER_TOKEN] Trying User Token for discordUserId: ${discordUserId}...`);
        const res = await user.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
          owner,
          repo,
          issue_number: issueNumber,
          assignees: [assignee],
        });
        logger.info("DEBUG_ASSIGN", `[USER_TOKEN] SUCCESS for ${owner}/${repo} #${issueNumber}! Status: ${res.status}`);
        return;
      } catch (e: any) {
        logger.error(
          "DEBUG_ASSIGN",
          `[USER_TOKEN] FAILED for ${owner}/${repo} #${issueNumber}. Status: ${e.status}, Message: ${e.message}`,
          e
        );
      }
    } else {
      logger.warn("DEBUG_ASSIGN", `[USER_TOKEN] No User Token found for discordUserId: ${discordUserId}`);
    }
  }

  try {
    logger.info("DEBUG_ASSIGN", `[APP_TOKEN] Trying App Installation Token for ${owner}/${repo}...`);
    const appOctokit = await getInstallationOctokit();
    const res = await appOctokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
      owner,
      repo,
      issue_number: issueNumber,
      assignees: [assignee],
    });
    logger.info("DEBUG_ASSIGN", `[APP_TOKEN] SUCCESS for ${owner}/${repo} #${issueNumber}! Status: ${res.status}`);
  } catch (e: any) {
    logger.error(
      "DEBUG_ASSIGN",
      `[APP_TOKEN] FAILED for ${owner}/${repo} #${issueNumber}. Status: ${e.status}, Message: ${e.message}`,
      e
    );
    throw e;
  }
}

export async function removeIssueAssignee(
  owner: string,
  repo: string,
  issueNumber: number,
  assignee: string,
  discordUserId?: string,
): Promise<void> {
  await requestWithUserFallback(discordUserId, async (octokit) => {
    await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees", {
      owner,
      repo,
      issue_number: issueNumber,
      assignees: [assignee],
    });
  });
}

export async function setIssueAssignees(
  owner: string,
  repo: string,
  issueNumber: number,
  assignees: string[],
  discordUserId?: string,
): Promise<void> {
  await requestWithUserFallback(discordUserId, async (octokit) => {
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner,
      repo,
      issue_number: issueNumber,
      assignees,
    });
  });
}

export async function getIssueAssignees(
  owner: string,
  repo: string,
  issueNumber: number,
  discordUserId?: string,
): Promise<string[]> {
  return await requestWithUserFallback(discordUserId, async (octokit) => {
    const res = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      owner,
      repo,
      issue_number: issueNumber,
    });
    return (res.data.assignees ?? []).map((a: { login: string }) => a.login);
  });
}

export interface IssueDetail {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  htmlUrl: string;
  userLogin: string;
  state: string;
  createdAt: string;
}

export interface IssueCommentDetail {
  id: number;
  userLogin: string;
  body: string;
  createdAt: string;
}

export async function getIssueDetails(
  owner: string,
  repo: string,
  issueNumber: number,
  discordUserId?: string,
): Promise<IssueDetail> {
  return await requestWithUserFallback(discordUserId, async (octokit) => {
    const res = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      owner,
      repo,
      issue_number: issueNumber,
    });
    const data = res.data;
    return {
      number: data.number,
      nodeId: data.node_id,
      title: data.title,
      body: data.body || "",
      htmlUrl: data.html_url,
      userLogin: data.user?.login || "unknown",
      state: data.state,
      createdAt: data.created_at,
    };
  });
}

export async function getIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  discordUserId?: string,
): Promise<IssueCommentDetail[]> {
  return await requestWithUserFallback(discordUserId, async (octokit) => {
    const res = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    return res.data.map((c: any) => ({
      id: c.id,
      userLogin: c.user?.login || "unknown",
      body: c.body || "",
      createdAt: c.created_at,
    }));
  });
}
