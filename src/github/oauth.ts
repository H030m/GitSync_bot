import { request } from "@octokit/request";
import { config } from "../config";
import { encrypt, decrypt } from "../utils/crypto";
import { logger } from "../utils/logger";

const OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const OAUTH_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

export function makeOAuthUrl(discordUserId: string): string {
  const statePayload = JSON.stringify({ uid: discordUserId, ts: Date.now() });
  const state = encrypt(statePayload, config.encryptionKey);
  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.server.baseUrl}/oauth/github/callback`,
    scope: "repo",
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function validateOAuthState(state: string): string {
  let raw: string;
  try {
    raw = decrypt(state, config.encryptionKey);
  } catch {
    throw new Error("Invalid OAuth state");
  }
  let payload: { uid: string; ts: number };
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("Invalid OAuth state payload");
  }
  if (Date.now() - payload.ts > 600_000) {
    throw new Error("OAuth state expired");
  }
  return payload.uid;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeCode(code: string): Promise<OAuthTokenResponse> {
  const res = await request("POST /login/oauth/access_token", {
    baseUrl: "",
    client_id: config.github.clientId,
    client_secret: config.github.clientSecret,
    code,
    headers: { accept: "application/json" },
  });
  if (res.data.error) {
    throw new Error(`OAuth exchange error: ${res.data.error_description ?? res.data.error}`);
  }
  return res.data as OAuthTokenResponse;
}

export async function refreshUserToken(refreshToken: string): Promise<OAuthTokenResponse> {
  const res = await request("POST /login/oauth/access_token", {
    baseUrl: "",
    client_id: config.github.clientId,
    client_secret: config.github.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    headers: { accept: "application/json" },
  });
  if (res.data.error) {
    throw new Error(`Token refresh error: ${res.data.error_description ?? res.data.error}`);
  }
  return res.data as OAuthTokenResponse;
}
