import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("link-repo")
  .setDescription("綁定目前頻道到 GitHub repo 與 Project")
  .addStringOption((opt) =>
    opt.setName("repo").setDescription("GitHub repo 網址或 owner/repo 格式（如 https://github.com/owner/repo）").setRequired(true),
  )
  .addStringOption((opt) =>
    opt.setName("project-url").setDescription("GitHub Project v2 網址（選填，如 https://github.com/orgs/org/projects/1）").setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName("project-owner").setDescription("Project 所屬的 owner（選填，user 或 org）").setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt.setName("project-number").setDescription("Project 編號（選填，從網址列看的數字）").setRequired(false),
  )
  .addStringOption((opt) =>
    opt.setName("issue-prefix").setDescription("Issue 標題前綴（選填，例如 [Openfoam]）").setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
