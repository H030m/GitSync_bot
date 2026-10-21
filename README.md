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
7. **YouTube 直播轉錄＋考試警報**：使用 `/live-alert start` 註冊一個直播，bot 即時轉成文字，偵測到老師要出題時在頻道 @ 指定對象；5 小時後自動關閉並上傳逐字稿（見 §7）。

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


---

## 7. 直播轉錄與考試警報（`/live-alert`）

註冊一個 YouTube 直播，bot 會在伺服器上即時轉錄成文字；偵測到老師要出題（quiz）時，在**下指令的頻道** @ 你指定的使用者或身分組。工作持續 **5 小時**後自動關閉，結束（或手動停止、直播結束）時把完整逐字稿 `.txt` 上傳到該頻道。bot 重啟後，還沒到期的工作會自動接續（同一個 ID、同一個結束時間，逐字稿接著寫）。

### 指令

| 指令 | 誰能用 | 說明 |
|------|--------|------|
| `/live-alert start url targets` | 所有人 | 開始轉錄；`targets` 直接 @ 使用者或身分組（最多 25 個，至少 1 個）。只接受 youtube.com / youtu.be，且必須是**進行中的直播**（已結束的錄影會回報「這不是正在進行的直播」） |
| `/live-alert stop [id]` | 所有人 | 停止本頻道的工作；不填 `id` 就全停 |
| `/live-alert status` | 所有人 | 看本頻道的工作（只有自己看得到） |
| `/live-alert ask question [id]` | 擁有者／被允許 `ask` 的人 | 根據逐字稿回答題目，**回答公開**，結尾註明提問者 |
| `/live-alert ideas [count] [id]` | 擁有者／被允許 `ideas` 的人 | 根據老師最近講的內容，想幾個像普通學生會問的問題，**只有自己看得到** |
| `/live-alert ask-access action user [scope]` | 只有擁有者 | 新增／移除／列出被允許的人；`scope` 可選 `ask`、`ideas` 或兩者（預設）。被允許的人 **5 小時後自動失效**，重新 add 會重新計時 |

擁有者由環境變數 `LIVE_ALERT_OWNER_ID` 指定（Discord user ID）。留空則沒有人是擁有者，`ask` / `ideas` / `ask-access` 都不能用。同時只追蹤 `LIVE_ALERT_MAX_SESSIONS` 個直播（預設 1），轉錄吃 CPU，不建議調高。

### 偵測流程

```
YouTube 直播
  → yt-dlp 取音訊串流（每 25 秒重新取一次簽章網址）
  → ffmpeg 轉 16 kHz 單聲道，切成 5 秒一段
  → faster-whisper（CPU、int8）轉文字，一句一行寫進逐字稿
  → worker 每秒讀新增的行，三條路同時判斷：
     ① 規則：alert.py 的單行關鍵字（小考／同學問題／點名抽問）與 Quiz 計分
     ② 句型：「進行／進入 今天的第 N 個」「先／來／就 考 大家／一個…」（Whisper 把 Quiz 聽成什麼字都抓得到）
     ③ LLM：每 15 秒把最近 90 秒逐字稿交給 Claude（haiku），判斷是不是在宣布要同學作答的測驗（不需要出現 Quiz 字樣）
  → 弱通知先複審 → bot 在頻道 @ 對象
```

- **複審**：「同學問題」、「小考」、以及「只靠 Quiz 這個字、沒有其他線索」的弱通知，通知前會先問 LLM；LLM 明確回答「不是出題」才擋，失敗或逾時一律照發。有「第 N 個」「接下來進入」等額外線索的通知、句型、LLM 自己的判斷都不複審。
- **靜音**：通知過 quiz 之後 3 分鐘內不再通知「同學問題」（出題時老師會一直說「請同學回答」）。
- **冷卻**：LLM 兩次通知間 3 分鐘；規則剛通知過 quiz 的 2 分鐘內 LLM 不重複；bot 端同類別 30 秒。
- 以上數字與規則是用 6 堂、共 30 個 quiz 的課堂錄影調出來的（**樣本內**，標註由模型推定、未經人工逐一確認），換老師或換講法不保證一樣準。

### 安裝轉錄環境（`stream2txt/`）

worker 放在獨立的 `stream2txt/` 目錄，需要另外 clone 原本的 [Instant-text-translation](https://github.com/H030m/Instant-text-translation)（取其 `run.py`／`alert.py`／`ask.py`，不修改）：

```bash
sudo apt install -y ffmpeg          # 用系統套件的 ffmpeg
cd stream2txt
git clone https://github.com/H030m/Instant-text-translation.git upstream
python3 -m venv .venv               # 或 uv venv
.venv/bin/pip install -r requirements.txt
# 先下載模型，之後 worker 不需要連網載入
HF_HOME=cache/huggingface HUGGINGFACE_HUB_CACHE=models .venv/bin/python -c \
  "from faster_whisper.utils import download_model as d; d('small', cache_dir='models')"
```

另外需要：
- **Node.js**：yt-dlp 解析 YouTube 需要 JavaScript runtime，worker 直接用 bot 的 node。
- **Claude Code CLI 且已登入**：LLM 第二關、`ask`、`ideas` 都是呼叫 `claude -p`，用的是**這台機器登入的帳號的額度**。LLM 第二關最多每 15 秒一次（5 小時上限約 1,200 次；單次呼叫實測約 5,500 輸入 tokens，這個數字只量過一次）。不想用就設 `STREAM2TXT_LLM=0`，只留規則偵測。
- 所有快取（模型、yt-dlp、Hugging Face）都放在 `stream2txt/` 底下，不寫 `$HOME/.cache`；逐字稿放在 `data/live-alerts/`，建議目錄 `700`、檔案 `600`。

### 環境變數

見 `.env.example` 最後一段。`LIVE_ALERT_OWNER_ID`、`LIVE_ALERT_MODEL`（Whisper 模型，預設 `small`）、`LIVE_ALERT_LANGUAGE`（預設 `auto`）、`LIVE_ALERT_MAX_SESSIONS`、`STREAM2TXT_LLM`、`STREAM2TXT_LLM_MODEL` 等。

### Worker 協定（bot ↔ `stream2txt/worker.py`）

bot 用 `child_process.spawn` 啟動 worker（`--url --output --max-seconds --model --language --refresh-seconds`），逐字稿由 worker 以 append 模式寫進 `--output`。worker 在 **stdout 每行輸出一個 JSON**，非 JSON 的行會被忽略：

| `type` | 欄位 | 意義 |
|--------|------|------|
| `status` | `message` | 只記 log |
| `quiz` | `category`、`text`、`stream_time` | 要通知；`category` 如 `疑似 Quiz（…）`、`同學問題`、`小考`、`LLM 判斷` |
| `error` | `message` | 記 warn log |
| `end` | `reason`：`stream-ended`／`deadline`／`not-live` | 之後 worker 以 exit code 0 結束 |

收到 SIGTERM 時 worker 會在 15 秒內收尾，否則被 SIGKILL。worker 異常結束（非 0）且還沒到期時，bot 30 秒後重試，最多 3 次。因為協定只有這幾行，worker 之後可以直接抽成獨立 repo 或換成別的實作。

### 已知限制

- 一個老師 5 個 quiz 以上的課，通知仍可能漏或多；不保證 100%。
- 通知會比老師講的晚：YouTube 直播本身延遲（未實測，一般約 10–30 秒）＋ 5 秒切段與轉錄 ＋ LLM 輪詢最多 15 秒。規則與句型抓到的比 LLM 快。
- 上游 `run.py` 的時間戳記在直播中會膨脹（每個 5 秒段重複累加偏移），逐字稿裡的秒數不是真實時間；worker 的 LLM 視窗用牆鐘時間，不受影響，但規則裡的計分視窗（40 秒）實際會變短。
- 逐字稿的錯字很多，`ask` 的答案要自己再確認。

