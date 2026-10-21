import type { App } from "@octokit/app";
import type { Octokit } from "@octokit/core";
import { config } from "../config";
import { logger } from "../utils/logger";

let _app: App | null = null;

async function getApp(): Promise<App> {
  if (!_app) {
    const { App } = await (Function('return import("@octokit/app")')() as Promise<typeof import("@octokit/app")>);
    _app = new App({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
    });
  }
  return _app;
}

async function getActiveInstallationId(): Promise<number> {
  const app = await getApp();
  try {
    const res = await app.octokit.request("GET /app/installations");
    if (res.data && res.data.length > 0) {
      logger.info(
        "app",
        `Active installations: ${res.data.map((i: any) => `${i.account?.login} (ID: ${i.id})`).join(", ")}`,
      );
      return res.data[res.data.length - 1].id;
    }
  } catch (e) {
    logger.error("app", "Failed to fetch installations dynamically", e);
  }
  return config.github.installationId;
}

export async function getInstallationOctokit(): Promise<Octokit> {
  const app = await getApp();
  const installationId = await getActiveInstallationId();
  return (await app.getInstallationOctokit(installationId)) as unknown as Octokit;
}

export async function getInstallationToken(): Promise<string> {
  const app = await getApp();
  const installationId = await getActiveInstallationId();
  const octokit = await app.getInstallationOctokit(installationId);
  const auth = (await octokit.auth({ type: "installation" })) as { token: string };
  return auth.token;
}
