import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("quota-daily")
  .setDescription("設定本頻道每天 12:00 自動發送用量日報")
  .addSubcommand((sub) => sub.setName("start").setDescription("啟用本頻道的每日用量日報"))
  .addSubcommand((sub) => sub.setName("stop").setDescription("停用本頻道的每日用量日報"))
  .addSubcommand((sub) => sub.setName("status").setDescription("查看本頻道日報設定狀態"))
  .addSubcommand((sub) =>
    sub.setName("debug").setDescription("debug：立刻模擬一次日報，不影響排程設定"),
  );
