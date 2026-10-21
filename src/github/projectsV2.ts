import { Octokit } from "@octokit/core";
import { getInstallationOctokit } from "./app";
import { getUserOctokit } from "./issues";
import { StatusField, StatusFieldOption } from "../store/channelLinks";
import { logger } from "../utils/logger";

interface ProjectV2Response {
  node?: {
    fields?: {
      nodes?: Array<{
        id: string;
        name: string;
        dataType: string;
        options?: Array<{ id: string; name: string }>;
      }>;
    };
  };
}

export async function fetchProjectStatusField(
  octokit: Octokit,
  projectId: string,
): Promise<StatusField> {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;
  const res = await octokit.graphql<ProjectV2Response>(query, { projectId });
  const fields = res.node?.fields?.nodes ?? [];
  const statusField = fields.find(
    (f) => f.dataType === "SINGLE_SELECT" && f.options && f.options.length > 0,
  );
  if (!statusField || !statusField.options) {
    throw new Error("No SINGLE_SELECT field with options found in project");
  }
  return {
    id: statusField.id,
    name: statusField.name,
    options: statusField.options.map((o) => ({ id: o.id, name: o.name })),
  };
}

export async function addIssueToProject(
  projectId: string,
  issueNodeId: string,
): Promise<string> {
  const octokit = await getInstallationOctokit();
  const query = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }
  `;
  const res = await octokit.graphql<{
    addProjectV2ItemById: { item: { id: string } };
  }>(query, { projectId, contentId: issueNodeId });
  return res.addProjectV2ItemById.item.id;
}

export async function updateProjectItemStatus(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  const octokit = await getInstallationOctokit();
  const query = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $value }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `;
  await octokit.graphql(query, {
    projectId,
    itemId,
    fieldId,
    value: optionId,
  });
}

export async function getProjectIdByNumber(
  owner: string,
  projectNumber: number,
  discordUserId?: string,
  repoName?: string,
): Promise<string> {
  let octokit: Octokit;
  if (discordUserId) {
    const user = await getUserOctokit(discordUserId);
    octokit = user ? user.octokit : await getInstallationOctokit();
  } else {
    octokit = await getInstallationOctokit();
  }

  // 1. Try Repository Project lookup if repoName is provided
  if (repoName) {
    try {
      const repoQuery = `
        query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            projectV2(number: $number) {
              id
            }
            projectsV2(first: 20) {
              nodes {
                id
                number
              }
            }
          }
        }
      `;
      const res = await octokit.graphql<{
        repository?: {
          projectV2?: { id: string };
          projectsV2?: { nodes?: Array<{ id: string; number: number }> };
        };
      }>(repoQuery, { owner, repo: repoName, number: projectNumber });

      if (res.repository?.projectV2?.id) {
        return res.repository.projectV2.id;
      }
      const match = res.repository?.projectsV2?.nodes?.find((p) => p.number === projectNumber);
      if (match?.id) {
        return match.id;
      }
    } catch (e: any) {
      logger.warn("projectsV2", `Repository project lookup skipped for ${owner}/${repoName}: ${e?.message}`);
    }
  }

  // 2. Try Organization lookup
  try {
    const orgQuery = `
      query($owner: String!, $number: Int!) {
        organization(login: $owner) {
          projectV2(number: $number) {
            id
          }
        }
      }
    `;
    const res = await octokit.graphql<{ organization?: { projectV2?: { id: string } } }>(orgQuery, {
      owner,
      number: projectNumber,
    });
    if (res.organization?.projectV2?.id) {
      return res.organization.projectV2.id;
    }
  } catch (e: any) {
    logger.warn("projectsV2", `Organization project lookup error: ${e?.message}`);
  }

  // 3. Try User lookup
  try {
    const userQuery = `
      query($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
          }
        }
      }
    `;
    const res = await octokit.graphql<{ user?: { projectV2?: { id: string } } }>(userQuery, {
      owner,
      number: projectNumber,
    });
    if (res.user?.projectV2?.id) {
      return res.user.projectV2.id;
    }
  } catch (e: any) {
    logger.warn("projectsV2", `User project lookup error: ${e?.message}`);
  }

  // Fallback: Try App token as last resort
  const appOctokit = await getInstallationOctokit();
  if (octokit !== appOctokit && repoName) {
    try {
      const repoQuery = `
        query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            projectV2(number: $number) {
              id
            }
            projectsV2(first: 20) {
              nodes {
                id
                number
              }
            }
          }
        }
      `;
      const res = await appOctokit.graphql<{
        repository?: {
          projectV2?: { id: string };
          projectsV2?: { nodes?: Array<{ id: string; number: number }> };
        };
      }>(repoQuery, { owner, repo: repoName, number: projectNumber });
      if (res.repository?.projectV2?.id) return res.repository.projectV2.id;
      const match = res.repository?.projectsV2?.nodes?.find((p) => p.number === projectNumber);
      if (match?.id) return match.id;
    } catch {
      // ignore
    }
  }

  throw new Error(`Project #${projectNumber} not found under "${owner}".`);
}
