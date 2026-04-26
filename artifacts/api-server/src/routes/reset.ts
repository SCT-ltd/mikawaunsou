import { Router } from "express";
import {
  db,
  attendanceRecordsTable,
  absenceRecordsTable,
  liveLocationsTable,
  attendanceDraftsTable,
  monthlyRecordsTable,
  payrollsTable,
  messagesTable,
  pushSubscriptionsTable,
  journalEntriesTable,
} from "@workspace/db";

const router = Router();

router.delete("/reset/operational-data", async (req, res) => {
  await db.delete(pushSubscriptionsTable);
  await db.delete(liveLocationsTable);
  await db.delete(attendanceDraftsTable);
  await db.delete(messagesTable);
  await db.delete(absenceRecordsTable);
  await db.delete(attendanceRecordsTable);
  await db.delete(monthlyRecordsTable);
  await db.delete(payrollsTable);
  await db.delete(journalEntriesTable);

  return res.json({ ok: true });
});

export default router;
