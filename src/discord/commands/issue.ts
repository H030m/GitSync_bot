import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("issue")
  .setDescription("管理 GitHub issue")
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("更新 issue 在 Project 裡的狀態")
      .addStringOption((opt) =>
        opt
          .setName("option")
          .setDescription("狀態選項")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("assign")
      .setDescription("指派負責人")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Discord 使用者").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("unassign")
      .setDescription("取消指派負責人")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Discord 使用者").setRequired(true),
      ),
  );
