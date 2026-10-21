import {
  Events,
  Client,
  Interaction,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  Message,
} from "discord.js";
import { logger } from "../../utils/logger";
import { makeOAuthUrl } from "../../github/oauth";
import {
  getChannelLink,
  setChannelLink,
  deleteChannelLink,
  ChannelLink,
} from "../../store/channelLinks";
import { getThreadIssue, setThreadIssue } from "../../store/threadIssues";
import { getGitHubLink } from "../../store/githubLinks";
import {
  getProjectIdByNumber,
  fetchProjectStatusField,
  updateProjectItemStatus,
} from "../../github/projectsV2";
import {
  setIssueAssignees,
  getIssueAssignees,
  addIssueAssignee,
  removeIssueAssignee,
  getIssueDetails,
  getIssueComments,
  getUserOctokit,
} from "../../github/issues";
import { getInstallationOctokit } from "../../github/app";
import { config } from "../../config";
import {
  dateRangeForPeriod,
  customDateRange,
  isValidDateString,
  QuotaPeriod,
  DateRange,
} from "../../hpc/quotaFetcher";
import { getTeamMembers, addTeamMember, getTeamMember } from "../../store/teamMembers";
import { buildQuotaReport } from "../../hpc/quotaReport";
import { checkQuotaAlerts, DEFAULT_ALERT_THRESHOLD } from "../../hpc/quotaAlerts";
import {
  addDailyChannel,
  removeDailyChannel,
  isDailyChannel,
  addAlertChannel,
  removeAlertChannel,
  getAlertChannel,
} from "../../store/quotaSchedule";
import { setDiscordId } from "../../store/discordLinks";

const PERIOD_LABEL: Record<QuotaPeriod, string> = {
  today: "今天",
  week: "本週",
  month: "本月",
};
import {
  getRepoWatch,
  setRepoWatch,
  deleteRepoWatch,
  RepoWatch,
} from "../../store/repoWatches";
import {
  startWatch,
  stopWatch,
  isWatching,
  checkVisibility,
  handlePublic,
} from "../../watch/repoWatcher";

function parseRepoInput(input: string): { repoOwner: string; repoName: string } | null {
  const clean = input.trim();
  const urlMatch = clean.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\?\s#]+)/i);
  if (urlMatch) {
    const owner = urlMatch[1];
    let name = urlMatch[2];
    if (name.endsWith(".git")) name = name.slice(0, -4);
    return { repoOwner: owner, repoName: name };
  }
  const parts = clean.split("/");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    let name = parts[1].trim();
    if (name.endsWith(".git")) name = name.slice(0, -4);
    return { repoOwner: parts[0].trim(), repoName: name };
  }
  return null;
}

function parseProjectInput(
  projectOwnerOpt?: string | null,
  projectNumberOpt?: number | null,
  projectUrlOpt?: string | null,
): { projectOwner: string; projectNumber: number } | null {
  if (projectUrlOpt) {
    const match = projectUrlOpt.match(/github\.com\/(?:orgs\/|users\/)?([^\/]+)\/projects\/(\d+)/i);
    if (match) {
      return { projectOwner: match[1], projectNumber: parseInt(match[2], 10) };
    }
  }
  if (projectOwnerOpt && projectOwnerOpt.includes("github.com")) {
    const match = projectOwnerOpt.match(/github\.com\/(?:orgs\/|users\/)?([^\/]+)\/projects\/(\d+)/i);
    if (match) {
      return { projectOwner: match[1], projectNumber: parseInt(match[2], 10) };
    }
  }
  if (projectOwnerOpt && projectNumberOpt) {
    return { projectOwner: projectOwnerOpt, projectNumber: projectNumberOpt };
  }
  return null;
}

async function handleLinkRepo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "你需要「管理頻道」權限才能使用此指令。", ephemeral: true });
    return;
  }
  const repoArg = interaction.options.getString("repo", true);
  const projectUrlOpt = interaction.options.getString("project-url");
  const projectOwnerOpt = interaction.options.getString("project-owner");
  const projectNumberOpt = interaction.options.getInteger("project-number");
  const issuePrefixOpt = interaction.options.getString("issue-prefix");

  const parsedRepo = parseRepoInput(repoArg);
  if (!parsedRepo) {
    await interaction.reply({
      content: "❌ Repo 格式錯誤！請提供 `owner/repo` 或 GitHub Repo 網址（如 `https://github.com/owner/repo`）。",
      ephemeral: true,
    });
    return;
  }

  const { repoOwner, repoName } = parsedRepo;

  await interaction.deferReply({ ephemeral: true });

  const parsedProject = parseProjectInput(projectOwnerOpt, projectNumberOpt, projectUrlOpt);

  try {
    let projectId: string | undefined;
    let statusField: any | undefined;
    let projectOwner: string | undefined;
    let projectNumber: number | undefined;

    let projectWarning = "";
    if (parsedProject) {
      projectOwner = parsedProject.projectOwner;
      projectNumber = parsedProject.projectNumber;
      try {
        projectId = await getProjectIdByNumber(projectOwner, projectNumber, interaction.user.id, repoName);
        const appOctokit = await getInstallationOctokit();
        statusField = await fetchProjectStatusField(appOctokit, projectId);
      } catch (e: any) {
        logger.warn("interaction", `Project #${projectNumber} lookup failed: ${e?.message}`);
        projectWarning = `\n⚠️ **Project #${projectNumber} 提示**：無法取得 Project 看板資訊（需要 ` +
          `NTHU-SC 組織 Admin 至 GitHub App 安裝設定點擊「Accept updated permissions」）。\n` +
          `✅ **Repo 綁定、Issue 建立與討論串同步仍已成功運作！**`;
      }
    }

    const link: ChannelLink = {
      channelId: interaction.channelId,
      guildId: interaction.guild.id,
      repoOwner,
      repoName,
    };
    if (projectOwner) link.projectOwner = projectOwner;
    if (projectNumber) link.projectNumber = projectNumber;
    if (projectId) link.projectId = projectId;
    if (statusField) link.statusField = statusField;
    if (issuePrefixOpt) link.issuePrefix = issuePrefixOpt;
    await setChannelLink(link);
    logger.info("interaction", `Linked channel ${interaction.channelId} to ${repoOwner}/${repoName}${projectNumber ? ` (Project #${projectNumber})` : ""}`);

    let msg = `✅ 已成功將此頻道綁定到 GitHub Repo：**${repoOwner}/${repoName}**`;
    if (issuePrefixOpt) {
      msg += `\nIssue 標題前綴：\`${issuePrefixOpt}\``;
    }
    if (projectNumber && statusField) {
      msg += `\nProject：**#${projectNumber}**（Owner: ${projectOwner}）\n` +
        `Status 欄位：「${statusField.name}」選項：${statusField.options.map((o: any) => o.name).join("、")}`;
    }
    if (projectWarning) {
      msg += projectWarning;
    }
    await interaction.editReply(msg);
  } catch (e) {
    logger.error("interaction", "link-repo failed", e);
    await interaction.editReply("❌ 綁定失敗，請確認 Repo / Project 網址是否正確且 GitHub App 已安裝存取該 Repo/Project。");
  }
}

async function handleUnlinkRepo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "你需要「管理頻道」權限才能使用此指令。", ephemeral: true });
    return;
  }
  await deleteChannelLink(interaction.channelId);
  await interaction.reply({ content: "✅ 已解除此頻道的綁定。", ephemeral: true });
}

async function handleLinkGithub(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = makeOAuthUrl(interaction.user.id);
  await interaction.reply({
    content: `請點擊以下連結連動你的 GitHub 帳號：\n${url}`,
    ephemeral: true,
  });
}

async function handleIssueStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread) {
    await interaction.reply({ content: "此指令僅能在討論串內使用。", ephemeral: true });
    return;
  }
  const threadIssue = await getThreadIssue(channel.id);
  if (!threadIssue) {
    await interaction.reply({ content: "此討論串沒有對應的 GitHub issue。", ephemeral: true });
    return;
  }
  const link = await getChannelLink(channel.parentId ?? "");
  if (!link || !link.statusField || !link.projectId) {
    await interaction.reply({ content: "此頻道未綁定 GitHub Project V2。", ephemeral: true });
    return;
  }

  const optionName = interaction.options.getString("option", true);
  const option = link.statusField.options.find((o) => o.name === optionName);
  if (!option) {
    await interaction.reply({ content: `找不到狀態選項「${optionName}」。`, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await updateProjectItemStatus(
      link.projectId,
      threadIssue.projectItemId,
      link.statusField.id,
      option.id,
    );
    await interaction.editReply(`✅ 狀態已更新為「${optionName}」。`);
  } catch (e) {
    logger.error("interaction", "issue status update failed", e);
    await interaction.editReply("❌ 狀態更新失敗。");
  }
}

async function handleIssueAssign(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread) {
    await interaction.reply({ content: "此指令僅能在討論串內使用。", ephemeral: true });
    return;
  }
  const threadIssue = await getThreadIssue(channel.id);
  if (!threadIssue) {
    await interaction.reply({ content: "此討論串沒有對應的 GitHub issue。", ephemeral: true });
    return;
  }

  const discordUser = interaction.options.getUser("user", true);
  const ghLink = await getGitHubLink(discordUser.id);
  if (!ghLink) {
    await interaction.reply({
      content: `**@${discordUser.username}** 尚未用 \`/link-github\` 連動 GitHub 帳號。`,
      ephemeral: true,
    });
    return;
  }

  const callerOctokit = await getUserOctokit(interaction.user.id);
  if (!callerOctokit) {
    await interaction.reply({
      content: `❌ 你的 GitHub 帳號授權已過期，請先在頻道輸入 \`/link-github\` 重新連動帳號。`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await addIssueAssignee(
      threadIssue.repoOwner,
      threadIssue.repoName,
      threadIssue.issueNumber,
      ghLink.githubLogin,
      interaction.user.id,
    );
    await interaction.editReply(`✅ 已指派 **@${ghLink.githubLogin}**（Discord: @${discordUser.username}）到此 issue。`);
  } catch (e: any) {
    logger.error("interaction", "issue assign failed", e);
    const errText = e.status === 404
      ? `❌ 指派失敗：無法指派至 **${threadIssue.repoOwner}/${threadIssue.repoName}**。\n` +
        `💡 **請檢查以下設定**：\n` +
        `1. 被指派者 **@${ghLink.githubLogin}** 是否已加入該 Repo 的成員列表。\n` +
        `2. 請開啟 [GitHub 應用程式授權頁面](https://github.com/settings/connections/applications/Iv23liLFDKJvpsZK9qnV)，對 **NTHU-SC** 點擊 **Grant (授權)**。`
      : `❌ 指派失敗 (${e.message ?? "未知錯誤"})。`;
    await interaction.editReply(errText);
  }
}

async function handleIssueUnassign(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread) {
    await interaction.reply({ content: "此指令僅能在討論串內使用。", ephemeral: true });
    return;
  }
  const threadIssue = await getThreadIssue(channel.id);
  if (!threadIssue) {
    await interaction.reply({ content: "此討論串沒有對應的 GitHub issue。", ephemeral: true });
    return;
  }

  const discordUser = interaction.options.getUser("user", true);
  const ghLink = await getGitHubLink(discordUser.id);
  if (!ghLink) {
    await interaction.reply({
      content: `**@${discordUser.username}** 尚未用 \`/link-github\` 連動 GitHub 帳號。`,
      ephemeral: true,
    });
    return;
  }

  const callerOctokit = await getUserOctokit(interaction.user.id);
  if (!callerOctokit) {
    await interaction.reply({
      content: `❌ 你的 GitHub 帳號授權已過期，請先在頻道輸入 \`/link-github\` 重新連動帳號。`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await removeIssueAssignee(
      threadIssue.repoOwner,
      threadIssue.repoName,
      threadIssue.issueNumber,
      ghLink.githubLogin,
      interaction.user.id,
    );
    await interaction.editReply(`✅ 已取消指派 **@${ghLink.githubLogin}**。`);
  } catch (e: any) {
    logger.error("interaction", "issue unassign failed", e);
    await interaction.editReply(`❌ 取消指派失敗 (${e.message ?? "未知錯誤"})。`);
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand !== "status") return;

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread) {
    await interaction.respond([]);
    return;
  }
  const link = await getChannelLink(channel.parentId ?? "");
  if (!link || !link.statusField) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused();
  const filtered = link.statusField.options
    .filter((o) => o.name.toLowerCase().includes(focused.toLowerCase()))
    .slice(0, 25)
    .map((o) => ({ name: o.name, value: o.name }));
  await interaction.respond(filtered);
}

async function handleExportChat(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.editReply("❌ 無法在此頻道類型使用此指令。");
    return;
  }

  const limitOpt = interaction.options.getInteger("limit") || 500;
  const maxLimit = Math.min(Math.max(limitOpt, 1), 5000);

  let allMessages: Message[] = [];
  let lastId: string | undefined;

  while (allMessages.length < maxLimit) {
    const fetchLimit = Math.min(100, maxLimit - allMessages.length);
    const options: { limit: number; before?: string } = { limit: fetchLimit };
    if (lastId) options.before = lastId;

    const fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;

    const arr = Array.from(fetched.values());
    allMessages.push(...arr);
    lastId = arr[arr.length - 1].id;

    if (fetched.size < fetchLimit) break;
  }

  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const channelName = "name" in channel ? (channel as any).name : "chat-export";
  let content = `# 📜 對話紀錄匯出：${channelName}\n`;
  content += `> 匯出時間：${new Date().toLocaleString()}\n`;
  content += `> 訊息總數：${allMessages.length}\n\n---\n\n`;

  for (const m of allMessages) {
    const time = new Date(m.createdTimestamp).toISOString().replace("T", " ").substring(0, 19);
    const authorName = m.author ? `${m.author.username} (${m.author.id})` : "系統/未知";
    content += `### [${time}] ${authorName}\n${m.content || "_(無文字內容/媒體附件)_"}\n\n`;
    if (m.attachments.size > 0) {
      content += `> 📎 附件：\n`;
      m.attachments.forEach((att) => {
        content += `> - [${att.name}](${att.url})\n`;
      });
      content += `\n`;
    }
  }

  const buffer = Buffer.from(content, "utf-8");
  const fileName = `export-${channelName.replace(/[^a-zA-Z0-9_\-]/g, "_")}-${Date.now()}.md`;
  const attachment = new AttachmentBuilder(buffer, { name: fileName });

  await interaction.editReply({
    content: `✅ 已成功匯出 **${allMessages.length}** 則對話紀錄！`,
    files: [attachment],
  });
}

async function handleImportIssue(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "請在已綁定 Repo 的文字頻道中使用此指令。", ephemeral: true });
    return;
  }

  const link = await getChannelLink(channel.id);
  if (!link) {
    await interaction.reply({ content: "❌ 此頻道尚未綁定 GitHub Repo！請先使用 `/link-repo` 指令。", ephemeral: true });
    return;
  }

  const issueNumber = interaction.options.getInteger("issue-number", true);

  await interaction.deferReply({ ephemeral: true });

  try {
    const issue = await getIssueDetails(link.repoOwner, link.repoName, issueNumber, interaction.user.id);
    const comments = await getIssueComments(link.repoOwner, link.repoName, issueNumber, interaction.user.id);

    const threadName = `#${issue.number}: ${issue.title}`.substring(0, 100);
    const thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: 1440,
      reason: `Imported GitHub Issue #${issue.number}`,
    });

    let projectItemId = "";
    await setThreadIssue({
      threadId: thread.id,
      channelId: channel.id,
      issueNumber: issue.number,
      issueNodeId: issue.nodeId,
      projectItemId,
      repoOwner: link.repoOwner,
      repoName: link.repoName,
    });

    const bodyContent = `📌 **GitHub Issue #${issue.number}** (${issue.state.toUpperCase()})\n` +
      `**作者**：@${issue.userLogin}\n` +
      `**連結**：${issue.htmlUrl}\n\n` +
      `${issue.body || "_(無內容)_"}`;
    await thread.send(bodyContent.substring(0, 2000));

    for (const comment of comments) {
      const msg = `💬 **Comment by @${comment.userLogin}** (${new Date(comment.createdAt).toLocaleString()}):\n${comment.body}`;
      await thread.send(msg.substring(0, 2000));
    }

    await interaction.editReply(`✅ 已成功匯入 Issue **#${issue.number}** 並建立討論串：${thread.url}`);
    logger.info("interaction", `Imported issue #${issue.number} into thread ${thread.id}`);
  } catch (e) {
    logger.error("interaction", "import-issue failed", e);
    await interaction.editReply(`❌ 匯入失敗，請確認 Issue #${issueNumber} 是否存在且 Bot 擁有存取權限。`);
  }
}

async function handleSetPrefix(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "你需要「管理頻道」權限才能使用此指令。", ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!channel) return;
  const channelId = channel.isThread() ? channel.parentId : channel.id;
  if (!channelId) return;

  const link = await getChannelLink(channelId);
  if (!link) {
    await interaction.reply({ content: "❌ 此頻道尚未綁定 GitHub Repo！請先使用 `/link-repo` 指令。", ephemeral: true });
    return;
  }

  const newPrefix = interaction.options.getString("prefix");

  if (!newPrefix || newPrefix.trim() === "" || newPrefix.toLowerCase() === "none") {
    delete link.issuePrefix;
    await setChannelLink(link);
    await interaction.reply({ content: "✅ 已成功清除此頻道的 Issue 標題前綴！", ephemeral: true });
  } else {
    link.issuePrefix = newPrefix.trim();
    await setChannelLink(link);
    await interaction.reply({ content: `✅ 已成功將此頻道的 Issue 標題前綴更新為：\`${link.issuePrefix}\``, ephemeral: true });
  }
}

async function handleWatchRepo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "你需要「管理頻道」權限才能使用此指令。", ephemeral: true });
    return;
  }

  const channelId = interaction.channelId;
  const sub = interaction.options.getSubcommand();

  if (sub === "stop") {
    stopWatch(channelId);
    const existing = await getRepoWatch(channelId);
    await deleteRepoWatch(channelId);
    await interaction.reply({
      content: existing
        ? `✅ 已停止監控 **${existing.repo}**。`
        : "此頻道本來就沒有在監控任何 repo。",
      ephemeral: true,
    });
    return;
  }

  if (sub === "status") {
    const watch = await getRepoWatch(channelId);
    if (!watch) {
      await interaction.reply({
        content: "此頻道沒有在監控任何 repo。用 `/watch-repo start` 開始。",
        ephemeral: true,
      });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    let now = "查詢失敗";
    try {
      const v = await checkVisibility(watch.repo);
      now = v === "public" ? "🎉 已公開" : v === "private" ? "🔒 仍是 private" : "❓ 狀態不明";
    } catch (e) {
      now = `⚠️ ${String(e)}`;
    }
    await interaction.editReply(
      `**${watch.repo}**\n` +
        `• 目前狀態：${now}\n` +
        `• 排程：每 ${watch.intervalMinutes} 分鐘，計時器 ${isWatching(channelId) ? "運行中" : "未運行"}\n` +
        `• private 時也回報：${watch.notifyOnPrivate ? "是" : "否"}\n` +
        `• 上次檢查：${watch.lastCheckedAt ?? "尚未檢查"}\n` +
        `• 已完成 clone：${watch.doneAt ?? "否"}`,
    );
    return;
  }

  // sub === "start"
  const repoArg = interaction.options.getString("repo") ?? config.watch.repo;
  const parsed = parseRepoInput(repoArg);
  if (!parsed) {
    await interaction.reply({
      content: "❌ Repo 格式錯誤！請提供 `owner/repo` 或 GitHub Repo 網址。",
      ephemeral: true,
    });
    return;
  }
  const repo = `${parsed.repoOwner}/${parsed.repoName}`;
  const intervalMinutes =
    interaction.options.getInteger("interval") ?? config.watch.intervalMinutes;
  const notifyOnPrivate =
    interaction.options.getBoolean("notify-private") ?? config.watch.notifyOnPrivate;

  await interaction.deferReply({ ephemeral: true });

  // 已經是 public 就不必排程，當場處理完
  let visibility: Awaited<ReturnType<typeof checkVisibility>>;
  try {
    visibility = await checkVisibility(repo);
  } catch (e) {
    await interaction.editReply(`❌ 無法查詢 \`${repo}\`：${String(e)}`);
    return;
  }

  const watch: RepoWatch = {
    channelId,
    guildId: interaction.guild.id,
    repo,
    intervalMinutes,
    notifyOnPrivate,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    lastStatus: visibility,
  };

  if (visibility === "public") {
    watch.doneAt = new Date().toISOString();
    await setRepoWatch(watch);
    const body = await handlePublic(repo);
    const channel = interaction.channel;
    if (channel?.isTextBased()) {
      await (channel as any).send({ content: body, allowedMentions: { parse: ["everyone"] } });
    }
    await interaction.editReply(`✅ \`${repo}\` 目前就已經是公開的，已直接處理完並在本頻道通知。`);
    return;
  }

  await setRepoWatch(watch);
  startWatch(interaction.client, watch);
  await interaction.editReply(
    `✅ 開始監控 **${repo}**（目前 🔒 尚未公開）\n` +
      `• 每 ${intervalMinutes} 分鐘掃一次，通知發在本頻道\n` +
      `• 掃到還是 private ${notifyOnPrivate ? "會" : "不會"}回報\n` +
      `• 一旦公開 → **@everyone** + 自動 clone 到 GCP VM + 回報磁碟空間，然後自動停止\n` +
      `隨時可用 \`/watch-repo status\` 查、\`/watch-repo stop\` 停。`,
  );
}

async function handleQuota(interaction: ChatInputCommandInteraction): Promise<void> {
  const startOpt = interaction.options.getString("start");
  const endOpt = interaction.options.getString("end");

  let range: DateRange;
  let rangeLabel: string;

  if (startOpt) {
    if (!isValidDateString(startOpt) || (endOpt && !isValidDateString(endOpt))) {
      await interaction.reply({
        content: "❌ `start`／`end` 格式要是 `YYYY-MM-DD`（例如 `2026-08-01`）。",
        ephemeral: true,
      });
      return;
    }
    const endStr = endOpt ?? new Date().toISOString().slice(0, 10);
    range = customDateRange(startOpt, endStr);
    rangeLabel = `${startOpt} ～ ${endStr}`;
  } else {
    const period = (interaction.options.getString("period") as QuotaPeriod) || "today";
    range = dateRangeForPeriod(period);
    rangeLabel = `${PERIOD_LABEL[period]}（${range.start} ～ 今天）`;
  }

  await interaction.deferReply();

  const { embed, attachment } = await buildQuotaReport(range, rangeLabel);
  await interaction.editReply({ embeds: [embed], files: [attachment] });
}

async function handleQuotaDaily(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === "start") {
    await addDailyChannel(interaction.channelId, interaction.guild.id);
    await interaction.reply(`✅ 已設定本頻道每天 **12:00**（台灣時間）自動發送用量日報。`);
    return;
  }
  if (sub === "stop") {
    await removeDailyChannel(interaction.channelId);
    await interaction.reply({ content: "✅ 已停止本頻道的每日用量日報。", ephemeral: true });
    return;
  }
  if (sub === "status") {
    const on = await isDailyChannel(interaction.channelId);
    await interaction.reply({
      content: on ? "📅 本頻道每天 12:00 會發用量日報。" : "本頻道目前沒有設定日報。",
      ephemeral: true,
    });
    return;
  }
  // debug：立刻用今天的資料發一次，不影響排程設定
  await interaction.deferReply();
  const range = dateRangeForPeriod("today");
  const { embed, attachment } = await buildQuotaReport(range, `今天（${range.start} ～ 今天，debug 模擬）`);
  await interaction.editReply({
    content: "🐛 **debug 模式**：這是模擬的每日日報，不代表排程已啟用。",
    embeds: [embed],
    files: [attachment],
  });
}

async function handleQuotaAlert(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === "start") {
    const threshold = interaction.options.getInteger("threshold") ?? DEFAULT_ALERT_THRESHOLD;
    await addAlertChannel(interaction.channelId, interaction.guild.id, threshold);
    await interaction.reply(
      `✅ 已設定本頻道每 **15 分鐘**檢查：當天有人花費（F1+nano4 合計）超過 **${threshold} 元**就會 @ 本人提醒（同一人同一天只提醒一次）。`,
    );
    return;
  }
  if (sub === "stop") {
    await removeAlertChannel(interaction.channelId);
    await interaction.reply({ content: "✅ 已停止本頻道的超額警報。", ephemeral: true });
    return;
  }
  if (sub === "status") {
    const cfg = await getAlertChannel(interaction.channelId);
    await interaction.reply({
      content: cfg
        ? `🚨 本頻道每 15 分鐘會檢查一次，門檻 **${cfg.thresholdTwd} 元**（同一人同一天只提醒一次）。`
        : "本頻道目前沒有設定超額警報。",
      ephemeral: true,
    });
    return;
  }
  // debug：立刻檢查一次今天的資料；threshold 選填，只用於這次模擬，不影響已設定的門檻
  await interaction.deferReply();
  const threshold = interaction.options.getInteger("threshold") ?? DEFAULT_ALERT_THRESHOLD;
  const alertResult = await checkQuotaAlerts(threshold);
  await interaction.editReply({
    content:
      `🐛 **debug 模式**：模擬門檻 ${threshold} 元的檢查結果，不代表排程已啟用／已真的發送警報。\n\n` +
      (alertResult.messages.length > 0
        ? alertResult.messages.join("\n")
        : "目前沒有人超過這個門檻。") +
      "\n\n" +
      alertResult.summary,
  });
}

async function handleLinkDiscord(interaction: ChatInputCommandInteraction): Promise<void> {
  const username = interaction.user.username.toLowerCase();
  const members = await getTeamMembers();
  const member = members.find((m) => m.discordUsername?.toLowerCase() === username);
  if (!member) {
    await interaction.reply({
      content:
        `❌ 找不到跟你的 Discord username \`${interaction.user.username}\` 對應的隊友名單，` +
        "請聯絡管理者用 `/quota-add-member` 把你加進監控名單。",
      ephemeral: true,
    });
    return;
  }
  await setDiscordId(member.hpcAccount, interaction.user.id);
  await interaction.reply({
    content: `✅ 已將你（${member.name}／\`${member.hpcAccount}\`）的 Discord 帳號跟用量警報綁定，之後超額會直接 @ 你。`,
    ephemeral: true,
  });
}

async function handleQuotaAddMember(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "此指令僅能在伺服器內使用。", ephemeral: true });
    return;
  }
  const hpcAccount = interaction.options.getString("hpc_account", true).trim();
  const name = interaction.options.getString("name", true).trim();
  const dcInput = interaction.options.getString("dc_id", true).trim().replace(/^@/, "");

  if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(hpcAccount)) {
    await interaction.reply({ content: "❌ 國網帳號格式看起來怪怪的，請確認一下。", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // 數字 ID 直接用；不是數字就當 username，透過 guild member search 查真正的數字 ID
  // （Discord 的 @ 通知只認數字 ID，username 可以自訂改變，不能拿來做通知，所以一定要轉換）。
  let discordId: string;
  let resolvedUsername = "";
  if (/^\d{15,25}$/.test(dcInput)) {
    discordId = dcInput;
  } else {
    const found = await interaction.guild.members.search({ query: dcInput, limit: 5 });
    const exact = [...found.values()].find((m) => m.user.username.toLowerCase() === dcInput.toLowerCase());
    const match = exact ?? found.first();
    if (!match) {
      await interaction.editReply(
        `❌ 在這個伺服器裡查不到 username \`${dcInput}\` 這個人，請確認拼字，或改貼數字使用者 ID。`,
      );
      return;
    }
    discordId = match.user.id;
    resolvedUsername = match.user.username;
  }

  const existing = await getTeamMember(hpcAccount);
  await addTeamMember(hpcAccount, name);
  await setDiscordId(hpcAccount, discordId);

  await interaction.editReply(
    `✅ ${existing ? "已更新" : "已新增"}監控名單：**${name}**／\`${hpcAccount}\`／<@${discordId}>` +
      (resolvedUsername ? `（從 username \`${resolvedUsername}\` 查到）` : "") +
      "\n之後 `/quota`、日報、警報都會包含這個人。",
  );
}

async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = {
    color: 0x5865f2,
    title: "🤖 GitSync Bot 指令說明與範例指南",
    description: "歡迎使用 GitSync Bot！以下是所有可用指令的詳細說明與範例：\n",
    fields: [
      {
        name: "1️⃣ `/link-repo` — 頻道與 GitHub Repo / Project 綁定",
        value:
          "**說明**：將目前頻道綁定至指定的 GitHub Repo 與 Project v2。\n" +
          "**參數**：\n" +
          "• `repo` (必填)：GitHub Repo 網址或 `owner/repo` 格式\n" +
          "• `project-url` (選填)：GitHub Project 網址\n" +
          "• `issue-prefix` (選填)：Issue 標題前綴（如 `[Openfoam]`）\n" +
          "**範例**：\n" +
          "`/link-repo repo: https://github.com/NTHU-SC/HPCAI26-Team1-OpenFOAM issue-prefix: [Openfoam]`",
      },
      {
        name: "2️⃣ `/set-prefix` — 設定或更新 Issue 標題前綴",
        value:
          "**說明**：更新目前頻道的 Issue 標題前綴（免重新綁定），開討論串時標題會自動加上此前綴。\n" +
          "**參數**：\n" +
          "• `prefix` (選填)：新前綴文字。若留空或填 `none` 則清除前綴。\n" +
          "**範例**：\n" +
          "`/set-prefix prefix: [Openfoam]`\n" +
          "`/set-prefix` *(清除前綴)*",
      },
      {
        name: "3️⃣ `/import-issue` — 匯入 GitHub Issue 至 Discord 討論串",
        value:
          "**說明**：將 GitHub 上現有的歷史 Issue 及其所有留言匯入並建立新的 Discord 討論串，同時自動建立雙向連動。\n" +
          "**參數**：\n" +
          "• `issue-number` (必填)：GitHub Issue 編號（例如 `11`）\n" +
          "**範例**：\n" +
          "`/import-issue issue-number: 11`",
      },
      {
        name: "4️⃣ `/export-chat` — 匯出頻道/討論串對話歷史紀錄",
        value:
          "**說明**：將目前頻道或討論串的完整對話紀錄匯出為整齊的 Markdown `.md` 檔案供下載。\n" +
          "**參數**：\n" +
          "• `limit` (選填)：訊息則數上限（預設 500，最多 5000）\n" +
          "**範例**：\n" +
          "`/export-chat`\n" +
          "`/export-chat limit: 1000`",
      },
      {
        name: "5️⃣ `/issue` — 管理 GitHub Issue (狀態/指派)",
        value:
          "**說明**：在討論串內更新 Issue 在 Project 中的狀態或變更負責人。\n" +
          "**子指令**：\n" +
          "• `/issue status option: Todo|In Progress|Done` — 變更看板狀態\n" +
          "• `/issue assign user: @DiscordUser` — 指派負責人\n" +
          "• `/issue unassign user: @DiscordUser` — 取消指派\n" +
          "**範例**：\n" +
          "`/issue status option: In Progress`\n" +
          "`/issue assign user: @username`",
      },
      {
        name: "6️⃣ `/link-github` — 個人 GitHub 帳號授權連動",
        value:
          "**說明**：取得專屬 OAuth 連結，將您的 Discord 帳號與 GitHub 帳號綁定。\n" +
          "**範例**：\n" +
          "`/link-github`",
      },
      {
        name: "7️⃣ `/watch-repo` — 監控 repo 何時公開",
        value:
          "**說明**：定期掃描指定 repo，一旦從 private 變公開，就在**你下指令的這個頻道** `@everyone` 通知，" +
          "並自動 clone 到 GCP VM、回報磁碟空間。\n" +
          "**子指令**：\n" +
          "• `/watch-repo start [repo] [interval] [notify-private]` — 開始監控（`repo` 省略用預設值；`interval` 單位分鐘，最小 5）\n" +
          "• `/watch-repo status` — 查看設定並立刻掃一次\n" +
          "• `/watch-repo stop` — 停止監控\n" +
          "**範例**：\n" +
          "`/watch-repo start repo: hpcac/2026-APAC-HPC-AI interval: 60`\n" +
          "`/watch-repo start interval: 30 notify-private: False`",
      },
      {
        name: "8️⃣ `/unlink-repo` — 解除頻道綁定",
        value:
          "**說明**：解除目前頻道與 GitHub Repo 的綁定關係。\n" +
          "**範例**：\n" +
          "`/unlink-repo`",
      },
      {
        name: "9️⃣ `/quota` — 查詢隊友 Slurm 用量與估算費用",
        value:
          "**說明**：查詢隊友在 F1 / nano4 的核心/GPU 小時用量並換算成新台幣估算費用，" +
          "含 F1+nano4 合計欄位（`sreport user TopUsage`，費率為學術計畫 NRQ）。\n" +
          "**參數**：\n" +
          "• `period` (選填)：`今天`｜`本週`｜`本月`，預設 `今天`；有給 `start` 就忽略這個\n" +
          "• `start` (選填)：自訂區間起始日 `YYYY-MM-DD`\n" +
          "• `end` (選填)：自訂區間結束日 `YYYY-MM-DD`，不填預設到今天\n" +
          "**範例**：\n" +
          "`/quota`\n" +
          "`/quota period: 本月`\n" +
          "`/quota start: 2026-08-01 end: 2026-08-15`",
      },
      {
        name: "🔟 `/quota-daily` — 每日用量日報",
        value:
          "**說明**：在某頻道跑一次 `start`，之後每天台灣時間 **12:00** 自動在該頻道發用量日報。\n" +
          "**子指令**：`start`｜`stop`｜`status`｜`debug`（debug 立刻模擬一次，不影響排程）\n" +
          "**範例**：\n" +
          "`/quota-daily start`\n" +
          "`/quota-daily debug`",
      },
      {
        name: "1️⃣1️⃣ `/quota-alert` — 用量超額警報",
        value:
          "**說明**：在某頻道跑一次 `start`，之後每 **15 分鐘**檢查一次當天花費，超過門檻（預設 5000 元）" +
          "就 @ 本人（同一人同一天只提醒一次；需要本人先跑過 `/link-discord`，或已由管理者手動綁定）。\n" +
          "**子指令**：`start [threshold]`｜`stop`｜`status`｜`debug [threshold]`\n" +
          "**範例**：\n" +
          "`/quota-alert start threshold: 5000`\n" +
          "`/quota-alert debug threshold: 1`",
      },
      {
        name: "1️⃣2️⃣ `/link-discord` — 綁定 Discord 帳號以便警報 @ 你",
        value:
          "**說明**：把你的 Discord 帳號跟隊友名單綁定，之後 `/quota-alert` 才能真的 @ 到你" +
          "（Discord 的 @ 通知只認數字 ID，不是用 username 就會通知）。\n" +
          "**範例**：\n" +
          "`/link-discord`",
      },
      {
        name: "1️⃣3️⃣ `/quota-add-member` — 新增監控名單成員",
        value:
          "**說明**：把一個人加進用量監控名單，`/quota`、日報、警報都會自動包含他。\n" +
          "**參數**：\n" +
          "• `hpc_account` (必填)：國網主機帳號\n" +
          "• `name` (必填)：顯示名稱，暱稱也可以\n" +
          "• `dc_id` (必填)：Discord username 或數字使用者 ID，bot 會自動查成真正的 ID\n" +
          "**範例**：\n" +
          "`/quota-add-member hpc_account: u1234567 name: 小明 dc_id: some_username`",
      },
    ],
    footer: {
      text: "GitSync Bot • GitHub & Discord 雙向自動化同步服務",
    },
  };

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export function onInteractionCreate(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction);
        return;
      }
      if (!interaction.isChatInputCommand()) return;

      switch (interaction.commandName) {
        case "link-repo":
          await handleLinkRepo(interaction);
          break;
        case "unlink-repo":
          await handleUnlinkRepo(interaction);
          break;
        case "link-github":
          await handleLinkGithub(interaction);
          break;
        case "export-chat":
          await handleExportChat(interaction);
          break;
        case "import-issue":
          await handleImportIssue(interaction);
          break;
        case "set-prefix":
          await handleSetPrefix(interaction);
          break;
        case "watch-repo":
          await handleWatchRepo(interaction);
          break;
        case "help":
          await handleHelp(interaction);
          break;
        case "quota":
          await handleQuota(interaction);
          break;
        case "quota-daily":
          await handleQuotaDaily(interaction);
          break;
        case "quota-alert":
          await handleQuotaAlert(interaction);
          break;
        case "link-discord":
          await handleLinkDiscord(interaction);
          break;
        case "quota-add-member":
          await handleQuotaAddMember(interaction);
          break;
        case "issue":
          switch (interaction.options.getSubcommand()) {
            case "status":
              await handleIssueStatus(interaction);
              break;
            case "assign":
              await handleIssueAssign(interaction);
              break;
            case "unassign":
              await handleIssueUnassign(interaction);
              break;
          }
          break;
      }
    } catch (e) {
      logger.error("interaction", "Unhandled interaction error", e);
      if (interaction.isRepliable()) {
        try {
          await (interaction.replied || interaction.deferred
            ? interaction.followUp({ content: "發生未預期的錯誤。", ephemeral: true })
            : interaction.reply({ content: "發生未預期的錯誤。", ephemeral: true }));
        } catch {
          // ignore reply errors
        }
      }
    }
  });
}
