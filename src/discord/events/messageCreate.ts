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

    if (!message.content.trim()) return;

    try {
      await addIssueComment(
        threadIssue.repoOwner,
        threadIssue.repoName,
        threadIssue.issueNumber,
        message.content,
        message.author.id,
        message.author.username,
      );
      logger.info("messageCreate", `Synced message from ${message.author.username} to issue #${threadIssue.issueNumber}`);
    } catch (e) {
      logger.error("messageCreate", "Failed to sync message to issue", e);
    }
  });
}
