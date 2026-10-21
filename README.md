# Discord GitHub Bot

 一個 Node.js + TypeScript + discord.js v14 的 Discord bot，讓 Discord 社群頻道跟 GitHub repo 的 Issue 與 Projects v2 雙向連動。

> 📖 伺服器管理與維護手冊為本機私有文件（含憑證與主機資訊），不納入版本控制。

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
- **Webhook**：✅ **Active**
  - **Webhook URL**：`https://<你的網域或IP>/webhook/github` (若無網域可用 `http://<你的IP>:3000/webhook/github`)
  - **Subscribe to events**：勾選 `Issues` 與 `Issue comment`
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
| `WATCH_ENABLED` | ❌ | 是否啟用 repo 公開監控（預設 `true`，設 `false` 關閉） |
| `WATCH_REPO` | ❌ | `/watch-repo start` 沒帶 `repo` 參數時的預設值（預設 `hpcac/2026-APAC-HPC-AI`） |
| `WATCH_INTERVAL_MINUTES` | ❌ | 沒帶 `interval` 參數時的預設掃描間隔（預設 60 分鐘） |
| `WATCH_CLONE_DIR` | ❌ | clone 目錄（預設 `./repos`，相對於程序 cwd；Docker 部署請設 `/data/repos`） |
| `WATCH_NOTIFY_ON_PRIVATE` | ❌ | 沒帶 `notify-private` 參數時的預設值（預設 `true`） |

---

## 4.5 Repo 公開監控（repo watcher）

由 **`/watch-repo`** 指令驅動，**通知就發在你下指令的那個頻道**（不需要事先設頻道 ID）。

| 指令 | 說明 |
|------|------|
| `/watch-repo start [repo] [interval] [notify-private]` | 開始監控。`repo` 省略時用 `WATCH_REPO`；`interval` 單位分鐘（最小 5，預設 60）；`notify-private` 預設 true |
| `/watch-repo status` | 顯示此頻道的監控設定，並**立刻**掃一次回報現況 |
| `/watch-repo stop` | 停止此頻道的監控 |

需要「管理頻道」權限。行為：

- **仍是 private**（GitHub API 回 404）→ 在該頻道發一則 `🔒 …尚未公開。`（不 mention 任何人）；`notify-private: false` 可關掉這種定期回報
- **已公開**（回 200）→ `git clone --depth 1` 到 `WATCH_CLONE_DIR`，跑 `df -h` / `du -sh` 回報磁碟空間，發一則 **`@everyone`**，然後這個 watch 自動停止
- clone 失敗仍然會 @everyone 通知公開這件事，只是訊息改附錯誤原因要你手動處理
- `start` 當下若 repo 已經是公開的，會直接處理完並回報，不會排程

實作重點：

1. **刻意用未認證的 GitHub API 查詢**。本 bot 的 GitHub App 若已安裝到該 repo，即使 repo 還是 private 也會拿到 200，就永遠測不出「何時對外公開」。
2. **watch 存在 `data/db.json` 的 `repoWatches`**（key = channelId，一個頻道一個 watch），bot 重啟時 `restoreWatchers()` 會把未完成的接回來；完成的會寫 `doneAt`，不會重複 clone、重複 @everyone。
3. **部署差異**：目前線上實際是用 **pm2** 跑（見本機私有的維護手冊），cwd = `~/discord-github-bot`，所以預設 clone 到 `~/discord-github-bot/repos`。若改用 Docker，容器是 `--rm`，需設 `WATCH_CLONE_DIR=/data/repos`，`deploy/discord-github-bot.service` 已加上對應的 `-v /opt/discord-github-bot/repos:/data/repos`。
4. **git 是選用的，有就用、沒有自動退回 tarball**：偵測到 `git` 就跑 `git clone --depth 1`；沒有就用 `curl` 抓 GitHub 的 `/repos/{repo}/tarball` 再 `tar` 解壓（會在 Discord 訊息中註明），拿不到 git 歷史、之後不能 `pull`。Docker 路線 `deploy/Dockerfile` 已加 `apk add --no-cache git coreutils`。
5. **線上 VM 目前沒有 git 也無法安裝**：帳號 `<vm-user>` 不在 `google-sudoers` 群組、密碼是鎖定狀態（`passwd -S` 回 `L`），且 `google-guest-agent` 為 inactive，所以 `sudo` 完全不可用。要恢復 sudo：GCP Console → 該 VM → 編輯 → 加 startup-script metadata `usermod -aG google-sudoers <vm-user>`，然後 Reset VM（startup-script 以 root 執行）。在那之前 watcher 走 tarball 路線，功能正常。

> ⚠️ `@everyone` 需要 bot 在該頻道有 **Mention @everyone, @here, and All Roles** 權限，否則訊息會照發但不會真的響鈴。

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
| `/watch-repo start` | 任何頻道 | Manage Channels | 監控 repo 何時公開，通知發在本頻道 |
| `/watch-repo status` | 任何頻道 | Manage Channels | 查看監控設定並立刻掃一次 |
| `/watch-repo stop` | 任何頻道 | Manage Channels | 停止本頻道的監控 |

---

## 8. 已知限制 / 未來可做（TODO）

- [ ] 目前只有 Discord → GitHub 單向同步：GitHub 上的留言**不會**同步回 Discord
- [ ] GitHub issue 被關閉時，不會自動封存（archive）對應的 Discord 討論串
- [ ] 目前 `/link-repo` 只認第一個 SINGLE_SELECT 欄位當作 Status 欄位，不支援多個狀態欄位
- [ ] 不支援 Label 同步（可在未來新增 `/issue label` 指令）
- [ ] 不支援 issue 被移出 Project（unlink）的處理
- [ ] 沒有 Dashboard 或 Web UI 可以查看所有綁定關係
- [ ] 使用者解除 GitHub OAuth 授權後，不會自動清除 Firestore 裡的 token（下次使用會 refresh 失敗自動降級用 App token）
