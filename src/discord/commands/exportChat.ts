import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("export-chat")
  .setDescription("匯出目前頻道或討論串的對話歷史紀錄為 Markdown 檔案")
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("匯出訊息數量（預設 500，最多 5000 則）")
      .setRequired(false),
  );
