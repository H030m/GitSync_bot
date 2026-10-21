import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "../../config";

export const definition = new SlashCommandBuilder()
  .setName("watch-repo")
  .setDescription("監控某個 GitHub repo 何時公開，通知就發在你下指令的這個頻道")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("開始監控，公開時 @everyone 並自動 clone 到 GCP VM")
      .addStringOption((opt) =>
        opt
          .setName("repo")
          .setDescription(`要監控的 repo，owner/repo 或網址（預設 ${config.watch.repo}）`)
          .setRequired(false),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("interval")
          .setDescription(`掃描間隔（分鐘，預設 ${config.watch.intervalMinutes}，最小 5）`)
          .setMinValue(5)
          .setMaxValue(1440)
          .setRequired(false),
      )
      .addBooleanOption((opt) =>
        opt
          .setName("notify-private")
          .setDescription("每次掃到還是 private 也回報一則（預設 true）")
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) => sub.setName("stop").setDescription("停止此頻道的監控"))
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("查看此頻道的監控狀態，並立刻掃一次"),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
