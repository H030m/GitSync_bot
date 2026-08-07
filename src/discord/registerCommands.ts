import { REST, Routes } from "discord.js";
import { config } from "../config";
import { logger } from "../utils/logger";
import { definition as linkRepo } from "./commands/linkRepo";
import { definition as unlinkRepo } from "./commands/unlinkRepo";
import { definition as linkGithub } from "./commands/linkGithub";
import { definition as issue } from "./commands/issue";

const commands = [linkRepo.toJSON(), unlinkRepo.toJSON(), linkGithub.toJSON(), issue.toJSON()];

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
