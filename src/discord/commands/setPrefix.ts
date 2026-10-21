import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("set-prefix")
  .setDescription("設定或更新目前頻道的 Issue 標題前綴（如 [Openfoam]）")
  .addStringOption((opt) =>
    opt
      .setName("prefix")
      .setDescription("Issue 標題前綴（留空或輸入 none 可清除前綴）")
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
