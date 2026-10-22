import app from "./app";
import { logger } from "./lib/logger";
import { startAlertJob } from "./lib/alerts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // 従業員のお知らせを1時間ごとに見直し、新しい要対応があれば事務所のPCへプッシュ通知する
  startAlertJob();
});
