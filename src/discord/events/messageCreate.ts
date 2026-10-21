import { Events, Client, Message, ChannelType } from "discord.js";
import { logger } from "../../utils/logger";
import { getThreadIssue } from "../../store/threadIssues";
import { addIssueComment } from "../../github/issues";

export function onMessageCreate(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    const channel = message.channel;
    if (channel.type !== ChannelType.PublicThread && channel.type !== ChannelType.PrivateThread) return;

    const threadIssue = await getThreadIssue(channel.id);
    if (!threadIssue) return;

    let fullContent = message.content.trim();

    if (message.attachments.size > 0) {
      const attachmentMarkdown = message.attachments
        .map((att) => {
          const isImage =
            att.contentType?.startsWith("image/") ||
            /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
          return isImage ? `![${att.name}](${att.url})` : `[📎 ${att.name}](${att.url})`;
        })
        .join("\n\n");

      fullContent = fullContent ? `${fullContent}\n\n${attachmentMarkdown}` : attachmentMarkdown;
    }

    if (!fullContent.trim()) return;

    try {
      await addIssueComment(
        threadIssue.repoOwner,
        threadIssue.repoName,
        threadIssue.issueNumber,
        fullContent,
        message.author.id,
        message.author.username,
      );
      logger.info("messageCreate", `Synced message from ${message.author.username} to issue #${threadIssue.issueNumber}`);
    } catch (e) {
      logger.error("messageCreate", "Failed to sync message to issue", e);
    }
  });
}
