import express from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { exchangeCode, validateOAuthState } from "../github/oauth";
import { encrypt } from "../utils/crypto";
import { setGitHubLink } from "../store/githubLinks";
import { request } from "@octokit/request";

export function createApp(): express.Application {
  const app = express();

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
      const userResp = await request("GET /user", {
        headers: { authorization: `token ${tokenResp.access_token}` },
      });
      const githubLogin = (userResp.data as { login: string }).login;
      const expiresAt = new Date(Date.now() + tokenResp.expires_in * 1000).toISOString();
      await setGitHubLink({
        discordUserId,
        githubLogin,
        encryptedAccessToken: encrypt(tokenResp.access_token, config.encryptionKey),
        encryptedRefreshToken: encrypt(tokenResp.refresh_token, config.encryptionKey),
        expiresAt,
      });
      logger.info("oauth", `Linked Discord user ${discordUserId} to GitHub @${githubLogin}`);
      res.status(200).send(`✅ 已成功連動 GitHub 帳號 **@${githubLogin}**！你可以關閉此頁面了。`);
    } catch (e) {
      logger.error("oauth", "OAuth callback error", e);
      res.status(400).send("❌ 授權失敗，請回到 Discord 重新使用 /link-github。");
    }
  });

  return app;
}
