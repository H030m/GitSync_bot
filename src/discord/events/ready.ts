import { Events, Client } from "discord.js";
import { logger } from "../../utils/logger";

export function onReady(client: Client): void {
  client.on(Events.ClientReady, () => {
    logger.info("discord", `Logged in as ${client.user?.tag}`);
  });
}
