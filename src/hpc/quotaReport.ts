import { AttachmentBuilder } from "discord.js";
import { fetchTeamUsage, HpcHost, HOST_RATE_TWD_PER_HOUR, DateRange } from "./quotaFetcher";
import { getTeamMembers } from "../store/teamMembers";
import { renderQuotaBarChart, PersonBarData } from "./quotaChart";

const HOST_LABEL: Record<HpcHost, string> = {
  f1: "🖥️ F1（創進一號，核心小時）",
  nano4: "🖥️ nano4（H200，GPU小時）",
};

export interface QuotaReport {
  embed: Record<string, any>;
  attachment: AttachmentBuilder;
  totalByAccount: Map<string, number>; // hpcAccount -> 元
}

export async function buildQuotaReport(range: DateRange, rangeLabel: string): Promise<QuotaReport> {
  const results = await fetchTeamUsage(range);
  const TEAM_MEMBERS = await getTeamMembers();

  const priceByAccount = new Map<string, number>();
  const priceByAccountAndHost = new Map<string, Partial<Record<HpcHost, number>>>();
  const fields = results.map((r) => {
    if (r.error) {
      return {
        name: HOST_LABEL[r.host],
        value: `⚠️ 查詢失敗：${r.error}\n（可能是 SSH ControlMaster 連線已斷，需要重新做 OTP 續命）`,
      };
    }
    const rate = HOST_RATE_TWD_PER_HOUR[r.host];
    let totalHours = 0;
    let totalPrice = 0;
    const lines = TEAM_MEMBERS.map((m) => {
      const hours = r.usageByAccount.get(m.hpcAccount);
      if (hours === undefined) {
        return `     -       -　${m.name}（${m.hpcAccount}）`;
      }
      totalHours += hours;
      const price = hours * rate;
      totalPrice += price;
      priceByAccount.set(m.hpcAccount, (priceByAccount.get(m.hpcAccount) ?? 0) + price);
      const perHost = priceByAccountAndHost.get(m.hpcAccount) ?? {};
      perHost[r.host] = price;
      priceByAccountAndHost.set(m.hpcAccount, perHost);
      return `${hours.toFixed(0).padStart(6)} 小時  約 ${price.toFixed(0).padStart(6)} 元　${m.name}（${m.hpcAccount}）`;
    });
    lines.push("----------------------------------------");
    lines.push(`${totalHours.toFixed(0).padStart(6)} 小時  約 ${totalPrice.toFixed(0).padStart(6)} 元　合計`);
    return {
      name: HOST_LABEL[r.host],
      value: "```\n" + lines.join("\n") + "\n```",
    };
  });

  let grandTotal = 0;
  const totalLines = TEAM_MEMBERS.map((m) => {
    const price = priceByAccount.get(m.hpcAccount);
    if (price === undefined) return `     -　${m.name}（${m.hpcAccount}）`;
    grandTotal += price;
    return `約 ${price.toFixed(0).padStart(6)} 元　${m.name}（${m.hpcAccount}）`;
  });
  totalLines.push("----------------------------------------");
  totalLines.push(`約 ${grandTotal.toFixed(0).padStart(6)} 元　合計`);
  fields.push({
    name: "💰 F1 + nano4 合計費用",
    value: "```\n" + totalLines.join("\n") + "\n```",
  });

  const chartData: PersonBarData[] = TEAM_MEMBERS.map((m) => ({
    name: m.name,
    pricesByHost: priceByAccountAndHost.get(m.hpcAccount) ?? {},
  }));
  const chartBuffer = renderQuotaBarChart(chartData, `隊友花費（${rangeLabel}）`);
  const attachment = new AttachmentBuilder(chartBuffer, { name: "quota-chart.png" });

  const embed = {
    color: 0x5865f2,
    title: "📊 隊友 Slurm 用量",
    description: `統計區間：${rangeLabel}（不含最後一天結束後的用量，核心/GPU 小時換算費率為估算）`,
    fields,
    image: { url: "attachment://quota-chart.png" },
    footer: {
      text:
        "資料來源：sreport user TopUsage｜費率（學術計畫 NRQ，2026-08-29 查）：" +
        "F1 0.2元/核心小時、nano4 60元/GPU小時，僅供參考",
    },
  };

  return { embed, attachment, totalByAccount: priceByAccount };
}
