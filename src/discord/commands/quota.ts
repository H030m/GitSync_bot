import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("quota")
  .setDescription("查詢隊友在 F1 / nano4 的 Slurm 用量與估算費用")
  .addStringOption((opt) =>
    opt
      .setName("period")
      .setDescription("查詢時段（預設：今天；有給 start 時忽略這個選項）")
      .addChoices(
        { name: "今天", value: "today" },
        { name: "本週", value: "week" },
        { name: "本月", value: "month" },
      ),
  )
  .addStringOption((opt) =>
    opt.setName("start").setDescription("自訂區間起始日（YYYY-MM-DD，含當天）"),
  )
  .addStringOption((opt) =>
    opt.setName("end").setDescription("自訂區間結束日（YYYY-MM-DD，含當天；不填預設到今天）"),
  );
