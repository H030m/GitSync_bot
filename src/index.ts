import { config } from "./config";
import { logger } from "./utils/logger";
import { createClient, startClient } from "./discord/client";
import { createApp } from "./server/httpServer";
import { restoreWatchers } from "./watch/repoWatcher";
import { startQuotaScheduler } from "./hpc/scheduler";

async function main() {
  logger.info("main", "Starting Discord GitHub Bot...");

  const client = createClient();

  const app = createApp(client);
  app.listen(config.server.port, () => {
    logger.info("main", `HTTP server listening on port ${config.server.port}`);
  });

  await startClient(client);

  await restoreWatchers(client);

  startQuotaScheduler(client);
}

main().catch((e) => {
  logger.error("main", "Fatal error", e);
  process.exit(1);
});
