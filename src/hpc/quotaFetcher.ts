import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/logger";
import { getTeamMembers } from "../store/teamMembers";

const execFileAsync = promisify(execFile);

export type HpcHost = "f1" | "nano4";
export type QuotaPeriod = "today" | "week" | "month";

// 元/小時，學術計畫費率。2026-08-29 使用者直接貼上 iService 帳務頁面原文確認：
// https://iservice.nchc.org.tw/nchc_service/nchc_service_qa.php?target=54
export const HOST_RATE_TWD_PER_HOUR: Record<HpcHost, number> = {
  f1: 0.2, // 核心小時
  nano4: 60, // GPU 小時（H200）
};

export interface HostUsageResult {
  host: HpcHost;
  usageByAccount: Map<string, number>; // hpcAccount -> total hours (summed across billing accounts)
  error?: string;
}

export interface DateRange {
  start: string; // YYYY-MM-DD，含當天
  end: string; // YYYY-MM-DD，sreport 的 end 是午夜切點，不含當天
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  return !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// sreport 的 end 是當天午夜切點，end 給「隔一天」才會把最後那天整天的用量算進去。
export function dateRangeForPeriod(period: QuotaPeriod): DateRange {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const end = ymd(tomorrow);

  if (period === "today") {
    return { start: ymd(now), end };
  }
  if (period === "week") {
    const dow = now.getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(now);
    monday.setUTCDate(monday.getUTCDate() - diffToMonday);
    return { start: ymd(monday), end };
  }
  // month
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: ymd(firstOfMonth), end };
}

// 自訂日期範圍：使用者給的 end 是「最後一天」（含當天），
// 轉成 sreport 要的午夜切點要 +1 天，跟 dateRangeForPeriod 的語意一致。
export function customDateRange(startStr: string, endStr: string): DateRange {
  const endDate = new Date(endStr + "T00:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return { start: startStr, end: ymd(endDate) };
}

// sreport 沒指定 -T 時預設算「cpu」TRES 的核心小時（正好是 F1 的計費單位，不用另外指定）。
// nano4 是 GPU 機器，計費單位是 GPU 小時，一定要明講 -T gres/gpu，
// 不然抓到的是 cpu 核心小時——2026-08-29 實測 nano4 上一顆 GPU 配 12 顆 CPU 的 job，
// 沒加 -T 的話數字會灌水整整 12 倍（灌水數字：1502，實際 GPU 小時：125，兩者比值=12=cpu/gpu 配比）。
// 有 -T 時欄位多一格（多出 TRES 名稱），hours 落在最後一欄，不再是倒數第二欄。
const HOST_TRES: Record<HpcHost, string | null> = {
  f1: null,
  nano4: "gres/gpu",
};

// 依賴 hpc-login skill 已建立的 SSH ControlMaster（~/.ssh/config 的 Host f1 / nano4）。
// 用 BatchMode=yes 是刻意的：master 沒續命時要立刻失敗回報，不要卡在互動式密碼/OTP 提示上。
async function runSreport(host: HpcHost, users: string[], range: DateRange): Promise<HostUsageResult> {
  const tres = HOST_TRES[host];
  const tresFlag = tres ? ` -T ${tres}` : "";
  const hoursFieldIndex = tres ? 5 : 4;
  const remoteCmd = `sreport user TopUsage start=${range.start} end=${range.end} -t Hours -n -P${tresFlag} Users=${users.join(",")}`;

  try {
    const { stdout } = await execFileAsync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, remoteCmd],
      { timeout: 20000 },
    );

    const usageByAccount = new Map<string, number>();
    for (const line of stdout.split("\n")) {
      const fields = line.trim().split("|");
      if (fields.length <= hoursFieldIndex) continue;
      const login = fields[1];
      const hours = Number(fields[hoursFieldIndex]);
      if (!login || Number.isNaN(hours)) continue;
      usageByAccount.set(login, (usageByAccount.get(login) ?? 0) + hours);
    }
    return { host, usageByAccount };
  } catch (e: any) {
    logger.error("quotaFetcher", `sreport on ${host} failed`, e);
    const msg = e?.stderr?.toString().trim() || e?.message || "未知錯誤";
    return { host, usageByAccount: new Map(), error: msg };
  }
}

export async function fetchTeamUsage(range: DateRange): Promise<HostUsageResult[]> {
  const members = await getTeamMembers();
  const users = members.map((m) => m.hpcAccount);
  return Promise.all([runSreport("f1", users, range), runSreport("nano4", users, range)]);
}
