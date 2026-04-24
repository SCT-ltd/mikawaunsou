import { Router, type IRouter } from "express";
import healthRouter from "./health";
import companyRouter from "./company";
import employeesRouter from "./employees";
import monthlyRecordsRouter from "./monthly_records";
import payrollRouter from "./payroll";
import journalEntriesRouter from "./journal_entries";
import dashboardRouter from "./dashboard";
import allowancesRouter from "./allowances";
import attendanceRouter from "./attendance";
import absencesRouter from "./absences";
import messagesRouter from "./messages";
import authRouter from "./auth";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(companyRouter);
router.use(employeesRouter);
router.use(monthlyRecordsRouter);
router.use(payrollRouter);
router.use(journalEntriesRouter);
router.use(dashboardRouter);
router.use(allowancesRouter);
router.use(attendanceRouter);
router.use(absencesRouter);
router.use("/messages", messagesRouter);
router.use(usersRouter);

export default router;
