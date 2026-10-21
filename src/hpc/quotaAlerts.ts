import { fetchTeamUsage, dateRangeForPeriod, HpcHost, HOST_RATE_TWD_PER_HOUR } from "./quotaFetcher";
import { getTeamMembers } from "../store/teamMembers";
import { getAllDiscordLinks } from "../store/discordLinks";

export const DEFAULT_ALERT_THRESHOLD = 5000;

export interface OverThresholdPerson {
  hpcAccount: string;
  name: string;
  total: number;
  mention: string; // <@id> 或找不到綁定時的純文字說明
}

export interface QuotaAlertResult {
  messages: string[]; // 每個超過門檻的人一則，含 @ 提及（若已綁定）
  summary: string;
  overThreshold: OverThresholdPerson[];
  dateStr: string; // 這次檢查的「今天」日期（YYYY-MM-DD），用來當通知去重的 key
}

// 檢查「今天」F1+nano4 合計花費超過門檻的人，回傳可直接發到 Discord 的訊息。
export async function checkQuotaAlerts(thresholdTwd: number): Promise<QuotaAlertResult> {
  const range = dateRangeForPeriod("today");
  const results = await fetchTeamUsage(range);
  const links = await getAllDiscordLinks();
  const TEAM_MEMBERS = await getTeamMembers();

  const totalByAccount = new Map<string, number>();
  for (const r of results) {
    if (r.error) continue;
    const rate = HOST_RATE_TWD_PER_HOUR[r.host as HpcHost];
    for (const [account, hours] of r.usageByAccount.entries()) {
      totalByAccount.set(account, (totalByAccount.get(account) ?? 0) + hours * rate);
    }
  }

  const overThreshold: OverThresholdPerson[] = [];
  const messages: string[] = [];
  for (const m of TEAM_MEMBERS) {
    const total = totalByAccount.get(m.hpcAccount) ?? 0;
    if (total <= thresholdTwd) continue;
    const discordId = links[m.hpcAccount];
    const mention = discordId ? `<@${discordId}>` : `**${m.name}**（尚未 \`/link-discord\`，無法 @ 通知）`;
    overThreshold.push({ hpcAccount: m.hpcAccount, name: m.name, total, mention });
    messages.push(
      `⚠️ ${mention} 今天在 F1+nano4 的花費約 **${total.toFixed(0)} 元**，已超過門檻 ${thresholdTwd} 元。`,
    );
  }

  const summary = `本次檢查區間：${range.start} ～ 今天，共 ${TEAM_MEMBERS.length} 人，${overThreshold.length} 人超過門檻。`;
  return { messages, summary, overThreshold, dateStr: range.start };
}
