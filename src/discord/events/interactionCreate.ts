import {
  Events,
  Client,
  Interaction,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { logger } from "../../utils/logger";
import { makeOAuthUrl } from "../../github/oauth";
import {
  getChannelLink,
  setChannelLink,
  deleteChannelLink,
  ChannelLink,
} from "../../store/channelLinks";
import { getThreadIssue } from "../../store/threadIssues";
import { getGitHubLink } from "../../store/githubLinks";
import {
  getProjectIdByNumber,
  fetchProjectStatusField,
  updateProjectItemStatus,
} from "../../github/projectsV2";
import { setIssueAssignees, getIssueAssignees } from "../../github/issues";
import { getInstallationOctokit } from "../../github/app";

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
  const projectOwner = interaction.options.getString("project-owner", true);
  const projectNumber = interaction.options.getInteger("project-number", true);

  const [repoOwner, repoName] = repoArg.split("/");
  if (!repoOwner || !repoName) {
    await interaction.reply({ content: "repo 格式錯誤，請用 owner/repo。", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const projectId = await getProjectIdByNumber(projectOwner, projectNumber);
    const appOctokit = await getInstallationOctokit();
    const statusField = await fetchProjectStatusField(appOctokit, projectId);

    const link: ChannelLink = {
      channelId: interaction.channelId,
      guildId: interaction.guild.id,
      repoOwner,
      repoName,
      projectOwner,
      projectNumber,
      projectId,
      statusField,
    };
    await setChannelLink(link);
    logger.info("interaction", `Linked channel ${interaction.channelId} to ${repoArg} project #${projectNumber}`);
    await interaction.editReply(
      `✅ 已綁定此頻道到 **${repoArg}** Project **#${projectNumber}**。\n` +
        `Status 欄位：「${statusField.name}」選項：${statusField.options.map((o) => o.name).join("、")}`,
    );
  } catch (e) {
    logger.error("interaction", "link-repo failed", e);
    await interaction.editReply("❌ 綁定失敗，請確認 repo 與 project 是否正確且 GitHub App 已安裝。");
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
  if (!link) {
    await interaction.reply({ content: "找不到頻道綁定資訊。", ephemeral: true });
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

  await interaction.deferReply({ ephemeral: true });
  try {
    const current = await getIssueAssignees(threadIssue.repoOwner, threadIssue.repoName, threadIssue.issueNumber);
    const newAssignees = [...new Set([...current, ghLink.githubLogin])];
    await setIssueAssignees(threadIssue.repoOwner, threadIssue.repoName, threadIssue.issueNumber, newAssignees);
    await interaction.editReply(`✅ 已指派 **@${ghLink.githubLogin}**（Discord: @${discordUser.username}）到此 issue。`);
  } catch (e) {
    logger.error("interaction", "issue assign failed", e);
    await interaction.editReply("❌ 指派失敗。");
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

  await interaction.deferReply({ ephemeral: true });
  try {
    const current = await getIssueAssignees(threadIssue.repoOwner, threadIssue.repoName, threadIssue.issueNumber);
    const newAssignees = current.filter((a) => a !== ghLink.githubLogin);
    await setIssueAssignees(threadIssue.repoOwner, threadIssue.repoName, threadIssue.issueNumber, newAssignees);
    await interaction.editReply(`✅ 已取消指派 **@${ghLink.githubLogin}**。`);
  } catch (e) {
    logger.error("interaction", "issue unassign failed", e);
    await interaction.editReply("❌ 取消指派失敗。");
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
  if (!link) {
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
