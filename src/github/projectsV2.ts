import { Octokit } from "@octokit/core";
import { getInstallationOctokit } from "./app";
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
): Promise<string> {
  const octokit = await getInstallationOctokit();
  const query = `
    query($owner: String!, $number: Int!) {
      user(login: $owner) {
        projectV2(number: $number) {
          id
        }
      }
      organization(login: $owner) {
        projectV2(number: $number) {
          id
        }
      }
    }
  `;
  const res = await octokit.graphql<{
    user?: { projectV2?: { id: string } };
    organization?: { projectV2?: { id: string } };
  }>(query, { owner, number: projectNumber });
  const project = res.user?.projectV2 ?? res.organization?.projectV2;
  if (!project) {
    throw new Error(`Project #${projectNumber} not found under owner "${owner}"`);
  }
  return project.id;
}
