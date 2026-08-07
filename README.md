# Discord GitHub Bot

一個 Node.js + TypeScript + discord.js v14 的 Discord bot，讓 Discord 社群頻道跟 GitHub repo 的 Issue 與 Projects v2 雙向連動。

## 功能總覽

1. **頻道 ↔ repo/project 連結**：使用 `/link-repo` 將 Discord 頻道綁定到 GitHub repo + Projects v2 board，`/unlink-repo` 解除綁定（僅限有管理頻道權限者）。
2. **開討論串 = 開 GitHub issue**：在已綁定頻道建立討論串時，自動在對應 repo 建立 issue，並加入 Project、設為第一個 Status 選項。
3. **討論串內改狀態**：使用 `/issue status` 在討論串內動態選擇該 Project 的 Status 欄位選項，即時更新。
4. **討論串訊息同步成 issue 留言**：已綁定討論串內的一般訊息，自動同步成 GitHub issue 的 comment。
5. **指派/取消指派負責人**：使用 `/issue assign` / `/issue unassign` 指派（有連動 GitHub 帳號的）Discord 使用者到 issue。
6. **GitHub 帳號連動**：使用 `/link-github` 進行 GitHub OAuth 授權，讓 bot 能代理使用者發 issue/留言。

---

## 1. 建立 GitHub App

前往 [GitHub Developer Settings](https://github.com/settings/apps) → New GitHub App：

- **GitHub App name**：自訂（如 `my-discord-bot`）
- **Homepage URL**：你的網站或 repo URL
- **Callback URL**：`https://<你的網域或IP>/oauth/github/callback`
- **Request user authorization (OAuth) during installation**：✅ 必須打勾
- **Webhook**：❌ 不需要勾選 Active（本 bot 用不到 webhook）
- **Repository permissions**：
  - `Issues`：Read & Write
  - `Metadata`：Read（自動勾選）
- **Organization permissions**（如要跨 org 使用）：
  - `Projects`：Read & Write
- **Where can this GitHub App be installed?**：依需求選擇（建議 Any account）
- 建立後：
  1. 記下 **App ID**
  2. 記下 **Client ID** 與 **Client Secret**（在「General」頁面產生）
  3. 下載 **Private key**（`.pem` 檔案）

安裝 App 到你的 org/repo（Install App → 選擇目標 org/account）。

記下 Installation ID：安裝完成後，網址列會是 `https://github.com/settings/installations/<INSTALLATION_ID>`，最後那串數字就是。

---

## 2. 建立 Discord Bot

前往 [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot：

1. **Bot → Privileged Gateway Intents**：
   - ✅ **MESSAGE CONTENT INTENT**（必須開啟，才能讀取討論串訊息內容）
2. **OAuth2 → URL Generator**：
   - Scopes：`bot`、`applications.commands`
   - Bot Permissions：`Manage Threads`、`Send Messages`、`Read Message History`、`Create Public Threads`、`Create Private Threads`
   - 用產生的 URL 把 bot 邀請進你的伺服器
3. 記下 Bot 頁面的 **Token**（Reset Token 取得），以及 OAuth2 頁面的 **Client ID**

---

## 3. Firestore 設定

1. 在 [GCP Console](https://console.cloud.google.com/) 建立或選擇一個 project
2. 啟用 Firestore：Firestore → 建立資料庫 → **Native mode** → 選擇離你最近的地區
3. IAM → 服務帳號 → 建立服務帳號：
   - 角色：`Cloud Datastore User`（Firestore User）
   - 建立後 → 金鑰 → 新增金鑰 → JSON → 下載
4. 把下載的 JSON 檔案放到安全位置，設定 `GOOGLE_APPLICATION_CREDENTIALS` 環境變數指向它

---

## 4. 環境變數表

參照 `.env.example`：

| 變數名稱 | 必要 | 說明 |
|----------|------|------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `DISCORD_CLIENT_ID` | ✅ | Discord application client ID |
| `DISCORD_GUILD_ID` | ❌ | 開發時指定 guild（只註冊 slash command 到該伺服器） |
| `GITHUB_APP_ID` | ✅ | GitHub App 的 App ID |
| `GITHUB_APP_PRIVATE_KEY` | ✅ | GitHub App 的 private key（PEM 內容或 `.pem` 路徑） |
| `GITHUB_INSTALLATION_ID` | ✅ | GitHub App installation ID |
| `GITHUB_CLIENT_ID` | ✅ | GitHub App 的 Client ID（OAuth 用） |
| `GITHUB_CLIENT_SECRET` | ✅ | GitHub App 的 Client Secret（OAuth 用） |
| `FIRESTORE_PROJECT_ID` | ❌ | GCP project ID（若未設會用服務帳號 JSON 裡的） |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ | Firestore 服務帳號 JSON 金鑰路徑 |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex 字串，用於加密存在 Firestore 的 token（`openssl rand -hex 32`） |
| `PORT` | ❌ | HTTP server port（預設 3000） |
| `BASE_URL` | ✅ | Bot 的公開網址，OAuth callback 會用到（如 `https://bot.example.com`） |

---

## 5. 本機開發

```bash
# 安裝依賴
npm install

# 複製並編輯環境變數
cp .env.example .env
# 編輯 .env 填入所有必要變數

# 型別檢查
npx tsc --noEmit

# 編譯
npm run build

# 啟動（編譯 + 執行）
npm run dev

# 單獨註冊 slash commands（不需啟動 bot）
npm run register
```

---

## 6. 部署到 GCP Compute Engine e2-micro

### 6.1 建立 VM

- GCP Console → Compute Engine → 建立執行個體
- 區域：臺灣（asia-east1）
- 機器類型：e2-micro
- 開機磁碟：Container-Optimized OS 或 Ubuntu 22.04 LTS
- 防火牆：允許 HTTP（80）與 HTTPS（443）流量

### 6.2 防火牆規則

確保 VM 的防火牆（GCP 的 VPC 防火牆規則）允許 TCP 80 和 443 進入。

### 6.3 上傳專案

```bash
# 從本機把專案複製到 VM
gcloud compute scp --recurse ./discord-github-bot <VM名稱>:/opt/discord-github-bot/
```

### 6.4 設定環境變數

在 VM 上編輯 `/opt/discord-github-bot/.env`，填入所有必要變數。

### 6.5 執行安裝腳本

```bash
# SSH 進 VM
gcloud compute ssh <VM名稱>

# 執行設定腳本
cd /opt/discord-github-bot
sudo bash deploy/gcp-setup-vm.sh
```

### 6.6 設定 Caddy 自動 HTTPS（建議）

OAuth callback 需要 HTTPS，建議使用 Caddy 做 reverse proxy + 自動 TLS：

```bash
sudo apt install -y caddy
```

編輯 `/etc/caddy/Caddyfile`：

```
bot.example.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 6.7 啟動服務

```bash
sudo systemctl start discord-github-bot
sudo systemctl status discord-github-bot
```

### 6.8 更新部署

```bash
cd /opt/discord-github-bot
git pull
sudo docker build -t discord-github-bot -f deploy/Dockerfile .
sudo systemctl restart discord-github-bot
```

---

## 7. 指令一覽

| 指令 | 使用範圍 | 權限 | 說明 |
|------|---------|------|------|
| `/link-repo` | 任何頻道 | Manage Channels | 綁定頻道到 GitHub repo + Project |
| `/unlink-repo` | 任何頻道 | Manage Channels | 解除綁定 |
| `/link-github` | 全域 | 所有人 | 取得 GitHub OAuth 授權連結 |
| `/issue status` | 已綁定討論串內 | 所有人 | 更新 issue 的 Project 狀態 |
| `/issue assign` | 已綁定討論串內 | 所有人 | 指派 GitHub 使用者到 issue |
| `/issue unassign` | 已綁定討論串內 | 所有人 | 取消指派 |

---

## 8. 已知限制 / 未來可做（TODO）

- [ ] 目前只有 Discord → GitHub 單向同步：GitHub 上的留言**不會**同步回 Discord
- [ ] GitHub issue 被關閉時，不會自動封存（archive）對應的 Discord 討論串
- [ ] 目前 `/link-repo` 只認第一個 SINGLE_SELECT 欄位當作 Status 欄位，不支援多個狀態欄位
- [ ] 不支援 Label 同步（可在未來新增 `/issue label` 指令）
- [ ] 不支援 issue 被移出 Project（unlink）的處理
- [ ] 沒有 Dashboard 或 Web UI 可以查看所有綁定關係
- [ ] 使用者解除 GitHub OAuth 授權後，不會自動清除 Firestore 裡的 token（下次使用會 refresh 失敗自動降級用 App token）
