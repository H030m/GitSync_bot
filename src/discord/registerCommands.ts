import { REST, Routes } from "discord.js";
import { config } from "../config";
import { logger } from "../utils/logger";
import { definition as linkRepo } from "./commands/linkRepo";
import { definition as unlinkRepo } from "./commands/unlinkRepo";
import { definition as linkGithub } from "./commands/linkGithub";
import { definition as issue } from "./commands/issue";
import { definition as exportChat } from "./commands/exportChat";
import { definition as importIssue } from "./commands/importIssue";
import { definition as setPrefix } from "./commands/setPrefix";
import { definition as watchRepo } from "./commands/watchRepo";
import { definition as help } from "./commands/help";
import { definition as quota } from "./commands/quota";
import { definition as quotaDaily } from "./commands/quotaDaily";
import { definition as quotaAlert } from "./commands/quotaAlert";
import { definition as linkDiscord } from "./commands/linkDiscord";
import { definition as quotaAddMember } from "./commands/quotaAddMember";
import { definition as liveAlert } from "./commands/liveAlert";

const commands = [
  linkRepo.toJSON(),
  unlinkRepo.toJSON(),
  linkGithub.toJSON(),
  issue.toJSON(),
  exportChat.toJSON(),
  importIssue.toJSON(),
  setPrefix.toJSON(),
  watchRepo.toJSON(),
  help.toJSON(),
  quota.toJSON(),
  quotaDaily.toJSON(),
  quotaAlert.toJSON(),
  linkDiscord.toJSON(),
  quotaAddMember.toJSON(),
  liveAlert.toJSON(),
];

async function main() {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);

  try {
    if (config.discord.guildId) {
      logger.info("register", `Registering guild commands for guild ${config.discord.guildId}`);
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), {
        body: commands,
      });
    } else {
      logger.info("register", "Registering global commands");
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
    }
    logger.info("register", `Registered ${commands.length} commands`);
  } catch (e) {
    logger.error("register", "Failed to register commands", e);
    process.exit(1);
  }
}

main();
