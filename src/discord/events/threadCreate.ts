import { Events, Client, ThreadChannel, ChannelType } from "discord.js";
import { logger } from "../../utils/logger";
import { getChannelLink } from "../../store/channelLinks";
import { setThreadIssue } from "../../store/threadIssues";
import { createIssue } from "../../github/issues";
import { addIssueToProject, updateProjectItemStatus } from "../../github/projectsV2";

export function onThreadCreate(client: Client): void {
  client.on(Events.ThreadCreate, async (thread: ThreadChannel, newlyCreated: boolean) => {
    if (!newlyCreated) return;
    if (thread.type !== ChannelType.PublicThread && thread.type !== ChannelType.PrivateThread) return;
    const parentId = thread.parentId;
    if (!parentId) return;

    const link = await getChannelLink(parentId);
    if (!link) return;

    try {
      await thread.join();

      let body = "";
      try {
        const starter = await thread.fetchStarterMessage();
        body = starter?.content || "";
      } catch {
        const msgs = await thread.messages.fetch({ limit: 1 });
        body = msgs.first()?.content || "";
      }
      if (!body.trim()) {
        body = `_由 Discord 討論串建立_\n📎 ${thread.url}`;
      } else {
        body = `${body}\n\n---\n📎 Discord 討論串：${thread.url}`;
      }

      const owner = thread.ownerId
        ? (await thread.guild.members.fetch(thread.ownerId)).user.username
        : "unknown";

      const issue = await createIssue(
        { owner: link.repoOwner, repo: link.repoName, title: thread.name, body },
        thread.ownerId ?? "",
        owner,
      );

      let projectItemId = "";
      const firstOption = link.statusField.options[0];
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
