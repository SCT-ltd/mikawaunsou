import app from "./app";
import { logger } from "./lib/logger";
import { startAlertJob } from "./lib/alerts";
import { startupChecks } from "./lib/startup";
import { startAttendanceJobs } from "./lib/alerts-attendance";
import { pool } from "@workspace/db";

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

await startupChecks();

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // 従業員のお知らせを1時間ごとに見直し、新しい要対応があれば事務所のPCへプッシュ通知する
  startAlertJob();
  // 毎朝、前の日から開いたままの勤務（退勤の打ち忘れ）を本人のスマホに知らせる
  startAttendanceJobs();
});

// 止めるとき（docker compose の入れ替え）に、受け付け中の要求を終えてから閉じる。
// 以前は終わりの合図を無視して10秒待たされ、強制終了されていた。
function shutdown(signal: string) {
  logger.info({ signal }, "終了します");
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  // つながったままの接続（リアルタイム受信）があっても5秒で終える
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
