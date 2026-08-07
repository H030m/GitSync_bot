import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("link-repo")
  .setDescription("綁定目前頻道到 GitHub repo 與 Project")
  .addStringOption((opt) =>
    opt.setName("repo").setDescription("owner/repo 格式").setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName("project-owner").setDescription("Project 所屬的 owner（user 或 org）").setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt.setName("project-number").setDescription("Project 編號（從網址列看的數字）").setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
