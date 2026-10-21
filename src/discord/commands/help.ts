import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("help")
  .setDescription("顯示 Discord GitHub Bot 的所有指令說明與使用範例");
