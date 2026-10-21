import { Events, Client, ThreadChannel, ChannelType, Message } from "discord.js";
import { logger } from "../../utils/logger";
import { getChannelLink } from "../../store/channelLinks";
import { setThreadIssue, getThreadIssue } from "../../store/threadIssues";
import { createIssue } from "../../github/issues";
import { addIssueToProject, updateProjectItemStatus } from "../../github/projectsV2";

export function onThreadCreate(client: Client): void {
  client.on(Events.ThreadCreate, async (thread: ThreadChannel, newlyCreated: boolean) => {
    if (!newlyCreated) return;
    if (thread.type !== ChannelType.PublicThread && thread.type !== ChannelType.PrivateThread) return;
    const parentId = thread.parentId;
    if (!parentId) return;

    // Ignore threads created by the Bot itself (e.g. /import-issue or webhook import)
    if (thread.ownerId === client.user?.id) return;

    // If thread is already mapped (e.g. created via /import-issue), ignore
    const existing = await getThreadIssue(thread.id);
    if (existing) return;

    const link = await getChannelLink(parentId);
    if (!link) return;

    try {
      await thread.join();

      let starterMsg: Message | null = null;
      try {
        starterMsg = await thread.fetchStarterMessage();
      } catch {
        const msgs = await thread.messages.fetch({ limit: 1 });
        starterMsg = msgs.first() || null;
      }

      let body = starterMsg?.content || "";
      if (starterMsg && starterMsg.attachments.size > 0) {
        const atts = starterMsg.attachments
          .map((att) => {
            const isImage =
              att.contentType?.startsWith("image/") ||
              /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
            return isImage ? `![${att.name}](${att.url})` : `[📎 ${att.name}](${att.url})`;
          })
          .join("\n\n");
        body = body ? `${body}\n\n${atts}` : atts;
      }

      if (!body.trim()) {
        body = `_由 Discord 討論串建立_\n📎 ${thread.url}`;
      } else {
        body = `${body}\n\n---\n📎 Discord 討論串：${thread.url}`;
      }

      const ownerName = thread.ownerId
        ? (await thread.guild.members.fetch(thread.ownerId)).user.username
        : "unknown";

      const prefix = link.issuePrefix ? `${link.issuePrefix.trim()} ` : "";
      const issueTitle = `${prefix}${thread.name}`;

      const issue = await createIssue(
        { owner: link.repoOwner, repo: link.repoName, title: issueTitle, body },
        thread.ownerId ?? "",
        ownerName,
      );

      let projectItemId = "";
      if (link.projectId && link.statusField) {
        const firstOption = link.statusField.options?.[0];
        try {
          projectItemId = await addIssueToProject(link.projectId, issue.nodeId);
          if (firstOption) {
            await updateProjectItemStatus(
              link.projectId,
              projectItemId,
              link.statusField.id,
              firstOption.id,
            );
          }
        } catch (e) {
          logger.error("threadCreate", "Failed to add issue to project", e);
        }
      }

      await setThreadIssue({
        threadId: thread.id,
        channelId: parentId,
        issueNumber: issue.number,
        issueNodeId: issue.nodeId,
        projectItemId,
        repoOwner: link.repoOwner,
        repoName: link.repoName,
      });

      await thread.send(`✅ GitHub issue 已建立：${issue.htmlUrl}`);
      logger.info("threadCreate", `Created issue #${issue.number} for thread ${thread.id}`);
    } catch (e) {
      logger.error("threadCreate", "Failed to create issue for thread", e);
      try {
        await thread.send("⚠️ 建立 GitHub issue 失敗，請確認 GitHub App 權限設定。");
      } catch {
        // ignore
      }
    }
  });
}
