import { Router, type IRouter } from "express";
import healthRouter from "./health";
import companyRouter from "./company";
import employeesRouter from "./employees";
import monthlyRecordsRouter from "./monthly_records";
import payrollRouter from "./payroll";
import journalEntriesRouter from "./journal_entries";
import dashboardRouter from "./dashboard";
import allowancesRouter from "./allowances";

const router: IRouter = Router();

router.use(healthRouter);
router.use(companyRouter);
router.use(employeesRouter);
router.use(monthlyRecordsRouter);
router.use(payrollRouter);
router.use(journalEntriesRouter);
router.use(dashboardRouter);
router.use(allowancesRouter);

export default router;
