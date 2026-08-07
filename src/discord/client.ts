import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "../config";
import { onReady } from "./events/ready";
import { onInteractionCreate } from "./events/interactionCreate";
import { onThreadCreate } from "./events/threadCreate";
import { onMessageCreate } from "./events/messageCreate";

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.ThreadMember],
  });

  onReady(client);
  onInteractionCreate(client);
  onThreadCreate(client);
  onMessageCreate(client);

  return client;
}

export async function startClient(client: Client): Promise<void> {
  await client.login(config.discord.token);
}
