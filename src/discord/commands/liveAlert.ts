import { SlashCommandBuilder } from "discord.js";

export const definition = new SlashCommandBuilder()
  .setName("live-alert")
  .setDescription("註冊 YouTube 直播即時轉錄，偵測到考試時 @ 指定對象（5 小時後自動關閉）")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("開始轉錄一個 YouTube 直播")
      .addStringOption((opt) =>
        opt.setName("url").setDescription("YouTube 直播網址").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("targets")
          .setDescription("要通知的對象：直接 @ 使用者或身分組，可多個")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("stop")
      .setDescription("停止直播轉錄")
      .addStringOption((opt) =>
        opt.setName("id").setDescription("要停止的工作 ID；不填則停止本頻道全部"),
      ),
  )
  .addSubcommand((sub) => sub.setName("status").setDescription("查看本頻道的直播轉錄工作"))
  .addSubcommand((sub) =>
    sub
      .setName("ask")
      .setDescription("（限擁有者與被允許的人）根據本頻道直播的逐字稿回答題目，回答公開，大家都看得到")
      .addStringOption((opt) =>
        opt.setName("question").setDescription("題目（可以整題連選項貼上）").setRequired(true).setMaxLength(4000),
      )
      .addStringOption((opt) =>
        opt.setName("id").setDescription("要用哪個工作的逐字稿；不填則用本頻道最近一個"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ideas")
      .setDescription("（限擁有者與被允許的人）根據老師剛講的內容，想幾個像普通學生會問的問題，只有你看得到")
      .addIntegerOption((opt) =>
        opt.setName("count").setDescription("要幾個問題（預設 5）").setMinValue(1).setMaxValue(8),
      )
      .addStringOption((opt) =>
        opt.setName("id").setDescription("要用哪個工作的逐字稿；不填則用本頻道最近一個"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("ask-access")
      .setDescription("（限擁有者）管理誰可以用 /live-alert ask")
      .addStringOption((opt) =>
        opt
          .setName("action")
          .setDescription("add 新增｜remove 移除｜list 列出")
          .setRequired(true)
          .addChoices(
            { name: "add 新增", value: "add" },
            { name: "remove 移除", value: "remove" },
            { name: "list 列出", value: "list" },
          ),
      )
      .addUserOption((opt) => opt.setName("user").setDescription("要新增或移除的使用者（list 不用填）"))
      .addStringOption((opt) =>
        opt
          .setName("scope")
          .setDescription("哪個指令的權限（預設兩個都是）")
          .addChoices(
            { name: "ask 回答題目（公開）", value: "ask" },
            { name: "ideas 提問建議（只有自己看到）", value: "ideas" },
            { name: "兩個都是", value: "both" },
          ),
      ),
  );
