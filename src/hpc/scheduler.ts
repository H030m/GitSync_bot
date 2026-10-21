import { Client, TextBasedChannel } from "discord.js";
import { logger } from "../utils/logger";
import { getDailyChannelIds, getAlertChannels } from "../store/quotaSchedule";
import { hasNotifiedToday, markNotified } from "../store/quotaAlertState";
import { dateRangeForPeriod } from "./quotaFetcher";
import { buildQuotaReport } from "./quotaReport";
import { checkQuotaAlerts } from "./quotaAlerts";

const TAIPEI_OFFSET_MINUTES = 8 * 60; // 台灣不用 DST，固定 UTC+8
const ALERT_POLL_INTERVAL_MS = 15 * 60 * 1000; // 每 15 分鐘檢查一次超額

function msUntilNextTaipei(hour: number, minute: number): number {
  const now = new Date();
  const nowTaipeiMs = now.getTime() + TAIPEI_OFFSET_MINUTES * 60 * 1000;
  const nowTaipei = new Date(nowTaipeiMs);

  const target = new Date(nowTaipei);
  target.setUTCHours(hour, minute, 0, 0);
  if (target.getTime() <= nowTaipei.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - nowTaipei.getTime();
}

async function runDailyReports(client: Client): Promise<void> {
  const channelIds = await getDailyChannelIds();
  if (channelIds.length === 0) return;

  const range = dateRangeForPeriod("today");
  let report;
  try {
    report = await buildQuotaReport(range, `今天（${range.start} ～ 今天）`);
  } catch (e) {
    logger.error("scheduler", "buildQuotaReport failed for daily report", e);
    return;
  }

  for (const channelId of channelIds) {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextBasedChannel | null;
      if (!channel || !("send" in channel)) continue;
      await channel.send({ content: "🗓️ **每日用量日報**", embeds: [report.embed], files: [report.attachment] });
    } catch (e) {
      logger.error("scheduler", `Failed to send daily report to channel ${channelId}`, e);
    }
  }
}

// 每 15 分鐘跑一次：誰「今天」花費超過門檻，只要還沒通知過就 @ 一次；
// 用 quotaAlertNotified 去重，同一人同一天同一頻道只提醒一次，換日期（隔天）就會重新算。
async function runAlertPoll(client: Client): Promise<void> {
  const alertChannels = await getAlertChannels();
  if (alertChannels.length === 0) return;

  for (const cfg of alertChannels) {
    try {
      const result = await checkQuotaAlerts(cfg.thresholdTwd);
      const freshMessages: string[] = [];
      for (const person of result.overThreshold) {
        const already = await hasNotifiedToday(cfg.channelId, result.dateStr, person.hpcAccount);
        if (already) continue;
        freshMessages.push(
          `⚠️ ${person.mention} 今天在 F1+nano4 的花費約 **${person.total.toFixed(0)} 元**，已超過門檻 ${cfg.thresholdTwd} 元。`,
        );
        await markNotified(cfg.channelId, result.dateStr, person.hpcAccount);
      }
      if (freshMessages.length === 0) continue;

      const channel = (await client.channels.fetch(cfg.channelId)) as TextBasedChannel | null;
      if (!channel || !("send" in channel)) continue;
      await channel.send({ content: freshMessages.join("\n") });
    } catch (e) {
      logger.error("scheduler", `Failed to run alert check for channel ${cfg.channelId}`, e);
    }
  }
}

// 每天台灣時間 12:00 發日報，用 setTimeout 算到下次 12:00 的時間差，
// 跑完後排下一次（24h 後）。警報走獨立的 15 分鐘輪詢，不綁在 12:00。
export function startQuotaScheduler(client: Client): void {
  const delay = msUntilNextTaipei(12, 0);
  logger.info("scheduler", `Next quota daily report in ${Math.round(delay / 60000)} minutes`);
  setTimeout(function tick() {
    runDailyReports(client).catch((e) => logger.error("scheduler", "runDailyReports failed", e));
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, delay);

  logger.info("scheduler", `Quota alert poll every ${ALERT_POLL_INTERVAL_MS / 60000} minutes`);
  setInterval(() => {
    runAlertPoll(client).catch((e) => logger.error("scheduler", "runAlertPoll failed", e));
  }, ALERT_POLL_INTERVAL_MS);
  // 啟動時先跑一次，不用等第一個 15 分鐘
  runAlertPoll(client).catch((e) => logger.error("scheduler", "initial runAlertPoll failed", e));
}
