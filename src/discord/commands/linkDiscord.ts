import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("link-discord")
  .setDescription("把你的 Discord 帳號跟隊友名單綁定，讓用量警報可以真正 @ 到你");
