import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("unlink-repo")
  .setDescription("解除目前頻道與 GitHub repo 的綁定")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
