import express from "express";
import { Client, TextChannel } from "discord.js";
import { config } from "../config";
import { logger } from "../utils/logger";
import { exchangeCode, validateOAuthState } from "../github/oauth";
import { encrypt } from "../utils/crypto";
import { setGitHubLink, getDiscordUserByGitHub } from "../store/githubLinks";
import { getChannelLinksByRepo } from "../store/channelLinks";
import { getThreadIssueByNumber, setThreadIssue } from "../store/threadIssues";
import { isRecentDiscordCommentId } from "../github/issues";

// Guards against duplicate `issues.opened` deliveries. The same event can arrive
// more than once: GitHub retries, and a repo-level webhook plus the App webhook
// both point at this endpoint. Covers the window before the thread mapping is
// persisted, where getThreadIssueByNumber still returns null.
const openingIssues = new Set<string>();

export function createApp(client?: Client): express.Application {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  app.get("/oauth/github/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      if (typeof code !== "string" || typeof state !== "string") {
        res.status(400).send("Missing code or state");
        return;
      }
      const discordUserId = validateOAuthState(state);
      const tokenResp = await exchangeCode(code);
      const userResp = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokenResp.access_token}`,
          "User-Agent": "Discord-GitHub-Bot",
        },
      });
      const userData = (await userResp.json()) as { login: string };
      const githubLogin = userData.login;
      const expiresInMs = tokenResp.expires_in ? tokenResp.expires_in * 1000 : 365 * 24 * 3600 * 1000;
      const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
      await setGitHubLink({
        discordUserId,
        githubLogin,
        encryptedAccessToken: encrypt(tokenResp.access_token, config.encryptionKey),
        encryptedRefreshToken: encrypt(tokenResp.refresh_token || "", config.encryptionKey),
        expiresAt,
      });
      logger.info("oauth", `Linked Discord user ${discordUserId} to GitHub @${githubLogin}`);
      res.status(200).send(`✅ 已成功連動 GitHub 帳號 **@${githubLogin}**！你可以關閉此頁面了。`);
    } catch (e) {
      logger.error("oauth", "OAuth callback error", e);
      res.status(400).send("❌ 授權失敗，請回到 Discord 重新使用 /link-github。");
    }
  });

  // GitHub Webhook Endpoint (GitHub -> Discord Sync)
  app.post("/webhook/github", async (req, res) => {
    try {
      const event = req.headers["x-github-event"];
      const payload = req.body;

      if (event === "ping") {
        logger.info("webhook", "Received GitHub webhook ping event");
        res.status(200).send("pong");
        return;
      }

      // Ignore actions triggered by GitHub bots to avoid loops
      if (payload.sender && payload.sender.type === "Bot") {
        res.status(200).send("Ignored bot event");
        return;
      }

      const repoOwner = payload.repository?.owner?.login;
      const repoName = payload.repository?.name;
      const senderLogin = payload.sender?.login;

      if (!repoOwner || !repoName || !senderLogin) {
        res.status(200).send("Event lacks repository or sender info");
        return;
      }

      // Helper to format author string: <@discordUserId> if linked, otherwise GitHub: @githubLogin
      const getAuthorTag = async (ghLogin: string): Promise<string> => {
        const discordUserId = await getDiscordUserByGitHub(ghLogin);
        return discordUserId ? `<@${discordUserId}>` : `**GitHub: @${ghLogin}**`;
      };

      // 1. Issue Opened Webhook Event
      if (event === "issues" && payload.action === "opened") {
        const issue = payload.issue;
        const bodyText = issue.body || "";
        if (bodyText.includes("📎 Discord 討論串：") || bodyText.includes("_由 Discord 討論串建立_")) {
          logger.info("webhook", `Ignored issue #${issue.number} originating from Discord`);
          res.status(200).send("Ignored issue from Discord");
          return;
        }

        const issueKey = `${repoOwner.toLowerCase()}/${repoName.toLowerCase()}#${issue.number}`;
        const existing = await getThreadIssueByNumber(repoOwner, repoName, issue.number);
        if (existing || openingIssues.has(issueKey)) {
          logger.info(
            "webhook",
            `Ignored duplicate issues.opened for ${issueKey}${existing ? ` (thread ${existing.threadId})` : ""}`,
          );
          res.status(200).send("Duplicate issue event");
          return;
        }
        openingIssues.add(issueKey);
        setTimeout(() => openingIssues.delete(issueKey), 120_000);

        const links = await getChannelLinksByRepo(repoOwner, repoName);
        if (links.length === 0) {
          logger.info("webhook", `No Discord channel linked for repo ${repoOwner}/${repoName}`);
          res.status(200).send("No linked channel");
          return;
        }

        const authorTag = await getAuthorTag(senderLogin);

        for (const link of links) {
          try {
            if (!client) continue;
            const channel = await client.channels.fetch(link.channelId);
            if (!channel || !channel.isTextBased()) continue;

            const textChannel = channel as TextChannel;
            const thread = await textChannel.threads.create({
              name: `[#${issue.number}] ${issue.title}`.substring(0, 100),
              reason: `Created via GitHub Issue #${issue.number}`,
            });

            let bodySnippet = bodyText;
            if (bodySnippet.length > 1500) {
              bodySnippet = bodySnippet.substring(0, 1500) + "...";
            }

            const initialMsg = `${authorTag} 在 GitHub 建立了 Issue **#${issue.number}**！\n\n**${issue.title}**\n${bodySnippet}\n\n🔗 ${issue.html_url}`;
            await thread.send(initialMsg);

            await setThreadIssue({
              threadId: thread.id,
              channelId: link.channelId,
              issueNumber: issue.number,
              issueNodeId: issue.node_id,
              projectItemId: "",
              repoOwner,
              repoName,
            });

            logger.info("webhook", `Created Discord thread ${thread.id} for GitHub Issue #${issue.number}`);
          } catch (e) {
            logger.error("webhook", `Error posting issue #${issue.number} to channel ${link.channelId}`, e);
          }
        }
        res.status(200).send("Issue event processed");
        return;
      }

      // 2. Issue Comment Created Webhook Event
      if (event === "issue_comment" && payload.action === "created") {
        const issue = payload.issue;
        const comment = payload.comment;
        if (!issue || !comment) {
          res.status(200).send("Missing issue or comment data");
          return;
        }

        const commentBody = comment.body || "";
        if (
          isRecentDiscordCommentId(comment.id) ||
          commentBody.includes("via Discord") ||
          commentBody.includes("由 Discord 討論串建立") ||
          commentBody.includes("Discord 討論串")
        ) {
          logger.info("webhook", `Ignored comment originating from Discord for issue #${issue.number} (comment ${comment.id})`);
          res.status(200).send("Ignored comment from Discord");
          return;
        }

        const threadIssue = await getThreadIssueByNumber(repoOwner, repoName, issue.number);
        if (!threadIssue) {
          res.status(200).send("No matching thread for issue");
          return;
        }

        const authorTag = await getAuthorTag(senderLogin);

        if (client) {
          try {
            const thread = await client.channels.fetch(threadIssue.threadId);
            if (thread && thread.isThread()) {
              await thread.send(`${authorTag}：\n${commentBody}`);
              logger.info("webhook", `Synced comment from GitHub Issue #${issue.number} to Discord thread ${thread.id}`);
            }
          } catch (e) {
            logger.error("webhook", `Error syncing comment to thread ${threadIssue.threadId}`, e);
          }
        }
        res.status(200).send("Comment event processed");
        return;
      }

      res.status(200).send("Event ignored");
    } catch (e) {
      logger.error("webhook", "Error processing webhook", e);
      res.status(500).send("Webhook error");
    }
  });

  return app;
}
