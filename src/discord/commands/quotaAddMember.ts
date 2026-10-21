import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("quota-add-member")
  .setDescription("把一個人加進用量監控名單（/quota、日報、警報都會包含）")
  .addStringOption((opt) =>
    opt.setName("hpc_account").setDescription("國網（F1/nano4）主機帳號").setRequired(true),
  )
  .addStringOption((opt) => opt.setName("name").setDescription("顯示名稱，暱稱也可以").setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName("dc_id")
      .setDescription("Discord username 或數字使用者 ID 都可以，bot 會自動查成真正的 ID")
      .setRequired(true),
  );
