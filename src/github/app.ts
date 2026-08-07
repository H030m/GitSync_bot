import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { config } from "../config";
import { logger } from "../utils/logger";

let _app: App | null = null;
const tokenCache = new Map<number, { token: string; expiresAt: number }>();

function getApp(): App {
  if (!_app) {
    _app = new App({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
    });
  }
  return _app;
}

export async function getInstallationOctokit(): Promise<Octokit> {
  const now = Date.now();
  const cached = tokenCache.get(config.github.installationId);
  if (cached && cached.expiresAt > now + 60_000) {
    return new Octokit({ auth: cached.token });
  }
  const app = getApp();
  const octokit = await app.getInstallationOctokit(config.github.installationId);
  const auth = (await octokit.auth()) as { token: string; expiresAt: string };
  tokenCache.set(config.github.installationId, {
    token: auth.token,
    expiresAt: new Date(auth.expiresAt).getTime(),
  });
  return octokit;
}

export async function getInstallationToken(): Promise<string> {
  const octokit = await getInstallationOctokit();
  const auth = (await octokit.auth()) as { token: string };
  return auth.token;
}
