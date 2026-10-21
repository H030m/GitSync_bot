import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("import-issue")
  .setDescription("將 GitHub 上現有的 Issue 匯入為此頻道的討論串")
  .addIntegerOption((opt) =>
    opt
      .setName("issue-number")
      .setDescription("GitHub Issue 編號（例如 123）")
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads);
