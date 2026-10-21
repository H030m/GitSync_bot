import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("quota-alert")
  .setDescription("設定本頻道每 15 分鐘檢查用量超額並 @ 本人")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("啟用本頻道的超額警報")
      .addIntegerOption((opt) =>
        opt.setName("threshold").setDescription("門檻（元，預設 5000）").setMinValue(1),
      ),
  )
  .addSubcommand((sub) => sub.setName("stop").setDescription("停用本頻道的超額警報"))
  .addSubcommand((sub) => sub.setName("status").setDescription("查看本頻道警報設定狀態"))
  .addSubcommand((sub) =>
    sub
      .setName("debug")
      .setDescription("debug：立刻模擬一次檢查，不影響排程設定")
      .addIntegerOption((opt) =>
        opt.setName("threshold").setDescription("這次模擬用的門檻（元，預設 5000，不影響已設定的值）").setMinValue(1),
      ),
  );
