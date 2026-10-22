import { Router } from "express";
import {
  db,
  employeesTable,
  attendanceRecordsTable,
  absenceRecordsTable,
  attendanceDraftsTable,
  liveLocationsTable,
  messagesTable,
  pushSubscriptionsTable,
  monthlyRecordsTable,
  payrollsTable,
  employeeAllowancesTable,
  employeeDeductionsTable,
  employeeMonthSetsTable,
  employeeMonthAllowancesTable,
  employeeMonthDeductionsTable,
} from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { issueDriverToken, qrKeyOk, tokenValid, newQrKey, weakPin, QR_KEY_REQUIRED_BODY } from "../lib/driver-token";
import { hashSecret, verifyPin } from "../lib/password";
import { audit, diffOf } from "../lib/audit";
import { isAdminReq } from "../lib/roles";

const router = Router();

// 暗証番号の照合の回数制限（社員＋接続元ごと）。api は1プロセスなのでメモリで足りる。
const PIN_MAX_FAILURES = 5;
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_LOCK_MS = 10 * 60 * 1000;
const pinAttempts = new Map<string, { failures: number; firstFailureAt: number; lockedUntil: number }>();
// 接続元を変えながら試す相手のために、社員ごとの合計も数える（1時間に20回でその社員を1時間止める）
const PIN_EMP_MAX = 20;
const PIN_EMP_WINDOW_MS = 60 * 60 * 1000;
const pinEmpAttempts = new Map<number, { failures: number; firstFailureAt: number; lockedUntil: number }>();

/**
 * 社員行から機密の `pin` を除去し、代わりに `hasPin`（設定有無）を付与する。
 * PIN は打刻認証の秘密情報なので、API レスポンスに値を含めない。
 */
function sanitizeEmployee(row: typeof employeesTable.$inferSelect) {
  const { pin, ...rest } = row;
  // qrKey は管理者にだけ返す（この関数を通すのは管理者向けの経路だけ。QR の URL を作るのに使う）
  return { ...rest, hasPin: !!pin };
}

router.get("/employees", async (req, res) => {
  const { active } = req.query;
  if (active !== undefined) {
    const activeFilter = active === "true";
    const rows = await db.select().from(employeesTable)
      .where(eq(employeesTable.isActive, activeFilter))
      .orderBy(asc(employeesTable.employeeCode));
    return res.json(rows.map(sanitizeEmployee));
  }
  const rows = await db.select().from(employeesTable)
    .orderBy(asc(employeesTable.employeeCode));
  return res.json(rows.map(sanitizeEmployee));
});

/** 電話番号：空なら null。形が違えば undefined（＝保存しない・400 を返す） */
function phoneOf(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[ー－]/g, "-");
  if (s === "") return null;
  return /^[0-9+()\- ]{6,20}$/.test(s) ? s : "__bad__";
}

router.post("/employees", async (req, res) => {
  const body = req.body;
  if (phoneOf(body.phone) === "__bad__") return res.status(400).json({ error: "電話番号は数字とハイフンで入れてください（例：080-1234-5678）" });
  const fields = {
    phone: phoneOf(body.phone) ?? null,
    name: body.name,
    nameKana: body.nameKana,
    department: body.department,
    position: body.position ?? "",
    baseSalary: body.baseSalary,
    salaryType: body.salaryType ?? "fixed",
    isOfficeStaff: body.isOfficeStaff ?? false,
    transportationAllowance: body.transportationAllowance ?? 0,
    safetyDrivingAllowance: body.safetyDrivingAllowance ?? 0,
    longDistanceAllowance: body.longDistanceAllowance ?? 0,
    positionAllowance: body.positionAllowance ?? 0,
    familyAllowance: body.familyAllowance ?? 0,
    earlyOvertimeAllowance: body.earlyOvertimeAllowance ?? 0,
    commissionRatePerKm: body.commissionRatePerKm ?? 0,
    commissionRatePerCase: body.commissionRatePerCase ?? 0,
    mikawaCommissionRate: body.mikawaCommissionRate ?? 0,
    useBluewingLogic: body.useBluewingLogic ?? false,
    bluewingCommissionRate: body.bluewingCommissionRate ?? 0,
    bluewingFixedOvertimeHours: body.bluewingFixedOvertimeHours ?? 0,
    bluewingFixedOvertimeAmount: body.bluewingFixedOvertimeAmount ?? 0,
    dependentCount: body.dependentCount ?? 0,
    hasSpouse: body.hasSpouse ?? false,
    standardRemuneration: body.standardRemuneration ?? 0,
    careInsuranceApplied: body.careInsuranceApplied ?? false,
    healthInsuranceMonthly: body.healthInsuranceMonthly ?? 0,
    pensionMonthly: body.pensionMonthly ?? 0,
    employmentInsuranceApplied: body.employmentInsuranceApplied ?? true,
    pensionApplied: body.pensionApplied ?? null,
    taxExempt: body.taxExempt ?? false,
    socialInsuranceExempt: body.socialInsuranceExempt ?? body.taxExempt ?? false,
    employmentInsuranceExempt: body.employmentInsuranceExempt ?? body.taxExempt ?? false,
    incomeTaxExempt: body.incomeTaxExempt ?? body.taxExempt ?? false,
    residentTax: body.residentTax ?? 0,
    dateOfBirth: body.dateOfBirth || null,
    hireDate: body.hireDate,
    isActive: true,
    scheduledWorkStart: body.scheduledWorkStart || null,
    scheduledWorkEnd: body.scheduledWorkEnd || null,
    dailyRateWeekday: body.dailyRateWeekday ?? 0,
    dailyRateSaturday: body.dailyRateSaturday ?? 0,
    overtimeHourlyRate: body.overtimeHourlyRate ?? 0,
    lateNightHourlyRate: body.lateNightHourlyRate ?? 0,
    overtimeUnitMinutes: body.overtimeUnitMinutes ?? null,
    overtimeUnitRate: body.overtimeUnitRate ?? 0,
    updatedAt: new Date(),
  };

  // 同じ社員コードでソフト削除済みレコードがあれば再有効化する
  const [existing] = await db.select({ id: employeesTable.id })
    .from(employeesTable)
    .where(eq(employeesTable.employeeCode, body.employeeCode));

  if (existing) {
    const [emp] = await db.update(employeesTable)
      .set(fields)
      .where(eq(employeesTable.id, existing.id))
      .returning();
    return res.status(200).json(sanitizeEmployee(emp));
  }

  const [emp] = await db.insert(employeesTable).values({
    employeeCode: body.employeeCode,
    ...fields,
  }).returning();
  return res.status(201).json(sanitizeEmployee(emp));
});

router.get("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  // この経路は QR 打刻ページのためにログインなしで開けてある。管理者以外には、打刻画面の
  // 表示に要る項目だけを返す（以前は基本給・標準報酬・住民税・生年月日まで返していた）。
  // さらに、QR の合言葉か暗証番号を確かめた印を持つ端末だけに返す（以前は番号を順に試すと
  // 全員の氏名・部署・勤務予定が取れた）。
  if (!isAdminReq(req) && !req.session?.userId && !(qrKeyOk(req, emp.qrKey) || (emp.pin && tokenValid(req, emp.id, emp.pin)))) {
    return res.status(403).json(QR_KEY_REQUIRED_BODY);
  }
  if (!isAdminReq(req)) {
    return res.json({
      id: emp.id,
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: emp.department,
      isOfficeStaff: emp.isOfficeStaff,
      // 事務員の打刻ページで「30分単位で切り上げるか」を出すため（金額は返さない）
      salaryType: emp.salaryType,
      scheduledWorkStart: emp.scheduledWorkStart,
      scheduledWorkEnd: emp.scheduledWorkEnd,
    });
  }
  return res.json(sanitizeEmployee(emp));
});

router.put("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body;
  const phone = phoneOf(body.phone);
  if (phone === "__bad__") return res.status(400).json({ error: "電話番号は数字とハイフンで入れてください（例：080-1234-5678）" });
  const [updated] = await db.update(employeesTable)
    .set({
      ...(phone !== undefined && { phone }),
      ...(body.employeeCode !== undefined && { employeeCode: body.employeeCode }),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.nameKana !== undefined && { nameKana: body.nameKana }),
      ...(body.department !== undefined && { department: body.department }),
      ...(body.position !== undefined && { position: body.position }),
      ...(body.salaryType !== undefined && { salaryType: body.salaryType }),
      ...(body.baseSalary !== undefined && { baseSalary: body.baseSalary }),
      ...(body.transportationAllowance !== undefined && { transportationAllowance: body.transportationAllowance }),
      ...(body.safetyDrivingAllowance !== undefined && { safetyDrivingAllowance: body.safetyDrivingAllowance }),
      ...(body.longDistanceAllowance !== undefined && { longDistanceAllowance: body.longDistanceAllowance }),
      ...(body.positionAllowance !== undefined && { positionAllowance: body.positionAllowance }),
      ...(body.familyAllowance !== undefined && { familyAllowance: body.familyAllowance }),
      ...(body.earlyOvertimeAllowance !== undefined && { earlyOvertimeAllowance: body.earlyOvertimeAllowance }),
      ...(body.commissionRatePerKm !== undefined && { commissionRatePerKm: body.commissionRatePerKm }),
      ...(body.commissionRatePerCase !== undefined && { commissionRatePerCase: body.commissionRatePerCase }),
      ...(body.mikawaCommissionRate !== undefined && { mikawaCommissionRate: body.mikawaCommissionRate }),
      ...(body.useBluewingLogic !== undefined && { useBluewingLogic: body.useBluewingLogic }),
      ...(body.bluewingCommissionRate !== undefined && { bluewingCommissionRate: body.bluewingCommissionRate }),
      ...(body.bluewingFixedOvertimeHours !== undefined && { bluewingFixedOvertimeHours: body.bluewingFixedOvertimeHours }),
      ...(body.bluewingFixedOvertimeAmount !== undefined && { bluewingFixedOvertimeAmount: body.bluewingFixedOvertimeAmount }),
      ...(body.dependentCount !== undefined && { dependentCount: body.dependentCount }),
      ...(body.hasSpouse !== undefined && { hasSpouse: body.hasSpouse }),
      ...(body.standardRemuneration !== undefined && { standardRemuneration: body.standardRemuneration }),
      ...(body.careInsuranceApplied !== undefined && { careInsuranceApplied: body.careInsuranceApplied }),
      ...(body.healthInsuranceMonthly !== undefined && { healthInsuranceMonthly: body.healthInsuranceMonthly }),
      ...(body.pensionMonthly !== undefined && { pensionMonthly: body.pensionMonthly }),
      ...(body.incomeTaxMonthly !== undefined && { incomeTaxMonthly: body.incomeTaxMonthly }),
      ...(body.otherDeductionMonthly !== undefined && { otherDeductionMonthly: body.otherDeductionMonthly }),
      ...(body.employmentInsuranceApplied !== undefined && { employmentInsuranceApplied: body.employmentInsuranceApplied }),
      ...('pensionApplied' in body && { pensionApplied: body.pensionApplied ?? null }),
      ...(body.taxExempt !== undefined && { taxExempt: body.taxExempt }),
      // 旧い画面の「全額非課税」は、分けた3つの印（社保・雇用保険・源泉税）にも同じ値を写す。
      // 3つを個別に送ってきたとき（法令の画面）はそちらを使う。
      ...(body.taxExempt !== undefined && body.socialInsuranceExempt === undefined && body.employmentInsuranceExempt === undefined && body.incomeTaxExempt === undefined && {
        socialInsuranceExempt: body.taxExempt === true, employmentInsuranceExempt: body.taxExempt === true, incomeTaxExempt: body.taxExempt === true,
      }),
      ...(typeof body.socialInsuranceExempt === "boolean" && { socialInsuranceExempt: body.socialInsuranceExempt }),
      ...(typeof body.employmentInsuranceExempt === "boolean" && { employmentInsuranceExempt: body.employmentInsuranceExempt }),
      ...(typeof body.incomeTaxExempt === "boolean" && { incomeTaxExempt: body.incomeTaxExempt }),
      ...(body.residentTax !== undefined && { residentTax: body.residentTax }),
      ...(body.dateOfBirth !== undefined && { dateOfBirth: body.dateOfBirth || null }),
      ...(body.hireDate !== undefined && { hireDate: body.hireDate }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.isOfficeStaff !== undefined && { isOfficeStaff: body.isOfficeStaff }),
      ...(body.scheduledWorkStart !== undefined && { scheduledWorkStart: body.scheduledWorkStart || null }),
      ...(body.scheduledWorkEnd !== undefined && { scheduledWorkEnd: body.scheduledWorkEnd || null }),
      ...(body.dailyRateWeekday !== undefined && { dailyRateWeekday: body.dailyRateWeekday }),
      ...(body.dailyRateSaturday !== undefined && { dailyRateSaturday: body.dailyRateSaturday }),
      ...(body.overtimeHourlyRate !== undefined && { overtimeHourlyRate: body.overtimeHourlyRate }),
      ...(body.lateNightHourlyRate !== undefined && { lateNightHourlyRate: body.lateNightHourlyRate }),
      ...(body.overtimeUnitMinutes !== undefined && { overtimeUnitMinutes: body.overtimeUnitMinutes ?? null }),
      ...(body.overtimeUnitRate !== undefined && { overtimeUnitRate: body.overtimeUnitRate }),
      updatedAt: new Date(),
    })
    .where(eq(employeesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  return res.json(sanitizeEmployee(updated));
});

router.delete("/employees/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  // 社員が存在するか確認
  const [emp] = await db.select({ id: employeesTable.id, name: employeesTable.name, employeeCode: employeesTable.employeeCode })
    .from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません" });

  // 給与明細・月次実績がある社員は物理削除を禁止（賃金台帳等の法定保存記録を守る）。
  // 退職の場合は在籍を OFF（論理削除）にする運用へ誘導する。
  const [existingPayroll] = await db.select({ id: payrollsTable.id })
    .from(payrollsTable).where(eq(payrollsTable.employeeId, id)).limit(1);
  const [existingRecord] = await db.select({ id: monthlyRecordsTable.id })
    .from(monthlyRecordsTable).where(eq(monthlyRecordsTable.employeeId, id)).limit(1);
  if (existingPayroll || existingRecord) {
    return res.status(409).json({
      error: "給与明細または月次実績がある社員は削除できません。退職の場合は「在籍」をOFFにしてください。",
    });
  }

  // 関連データを1回のトランザクションで削除（外部キー制約順）。以前は1つずつ消していたため、
  // 途中で失敗すると半分だけ消えた状態で残り、月ごとの手当・控除は消さずに残っていた。
  await db.transaction(async (tx) => {
    await tx.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.employeeId, id));
    await tx.delete(liveLocationsTable).where(eq(liveLocationsTable.employeeId, id));
    await tx.delete(attendanceDraftsTable).where(eq(attendanceDraftsTable.employeeId, id));
    await tx.delete(employeeAllowancesTable).where(eq(employeeAllowancesTable.employeeId, id));
    await tx.delete(employeeDeductionsTable).where(eq(employeeDeductionsTable.employeeId, id));
    await tx.delete(employeeMonthAllowancesTable).where(eq(employeeMonthAllowancesTable.employeeId, id));
    await tx.delete(employeeMonthDeductionsTable).where(eq(employeeMonthDeductionsTable.employeeId, id));
    await tx.delete(employeeMonthSetsTable).where(eq(employeeMonthSetsTable.employeeId, id));
    await tx.delete(absenceRecordsTable).where(eq(absenceRecordsTable.employeeId, id));
    await tx.delete(attendanceRecordsTable).where(eq(attendanceRecordsTable.employeeId, id));
    await tx.delete(monthlyRecordsTable).where(eq(monthlyRecordsTable.employeeId, id));
    await tx.delete(payrollsTable).where(eq(payrollsTable.employeeId, id));
    await tx.delete(messagesTable).where(eq(messagesTable.employeeId, id));
    await tx.delete(employeesTable).where(eq(employeesTable.id, id));
  });
  await audit(req, "employee.delete", `employee:${id}`, { name: emp.name, code: emp.employeeCode });

  return res.status(204).send();
});

// ── PIN管理 ───────────────────────────────────────────────────────

// PIN設定・変更（管理者用）
router.put("/employees/:id/pin", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ error: "PINは4桁の数字で入力してください" });
  }
  if (weakPin(String(pin))) {
    return res.status(400).json({ error: "同じ数字の繰り返しや「1234」のような並びは使えません" });
  }
  const [updated] = await db.update(employeesTable)
    .set({ pin: hashSecret(String(pin)), updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning({ id: employeesTable.id });
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  await audit(req, "pin.set", `employee:${id}`);
  return res.json({ ok: true });
});

// PINリセット（管理者用）
router.delete("/employees/:id/pin", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [updated] = await db.update(employeesTable)
    .set({ pin: null, updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning({ id: employeesTable.id });
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  await audit(req, "pin.clear", `employee:${id}`);
  return res.json({ ok: true });
});

// QR の合言葉を作り直す（管理者用）。古い QR コードは使えなくなる（退職・紛失のとき）。
router.post("/employees/:id/qr-key/rotate", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [updated] = await db.update(employeesTable)
    .set({ qrKey: newQrKey(), updatedAt: new Date() })
    .where(eq(employeesTable.id, id))
    .returning({ id: employeesTable.id, qrKey: employeesTable.qrKey });
  if (!updated) return res.status(404).json({ error: "社員が見つかりません。" });
  await audit(req, "qrkey.rotate", `employee:${id}`);
  return res.json(updated);
});

// 暗証番号を本人が決める（打刻ページ・まだ暗証番号が無い人だけ）。
// QR の合言葉を持つ端末からだけ受け付け、決めたらその端末に印を渡す。
// すでに暗証番号がある人は変えられない（変えるのは事務所＝PUT /employees/:id/pin）。
router.post("/employees/:id/pin/setup", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { pin } = req.body ?? {};
  const [emp] = await db.select({ pin: employeesTable.pin, qrKey: employeesTable.qrKey }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  if (!qrKeyOk(req, emp.qrKey)) return res.status(403).json(QR_KEY_REQUIRED_BODY);
  if (emp.pin) return res.status(409).json({ error: "暗証番号はすでに決まっています。忘れたときは事務所に連絡してください。", code: "pin-already-set" });
  if (!pin || !/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: "4桁の数字で決めてください" });
  if (weakPin(String(pin))) return res.status(400).json({ error: "同じ数字の繰り返しや「1234」のような並びは使えません" });
  const stored = hashSecret(String(pin));
  // 同時に2台から決めようとしたときに後から上書きしないよう、まだ無いときだけ書く
  const [updated] = await db.update(employeesTable)
    .set({ pin: stored, updatedAt: new Date() })
    .where(and(eq(employeesTable.id, id), isNull(employeesTable.pin)))
    .returning({ id: employeesTable.id });
  if (!updated) return res.status(409).json({ error: "暗証番号はすでに決まっています。忘れたときは事務所に連絡してください。", code: "pin-already-set" });
  await audit(req, "pin.self-set", `employee:${id}`);
  issueDriverToken(res, id, stored);
  return res.json({ ok: true });
});

// PIN照合（ドライバー用）
router.post("/employees/:id/pin/verify", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { pin } = req.body ?? {};
  const [emp] = await db.select({ pin: employeesTable.pin, qrKey: employeesTable.qrKey }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  // QR の合言葉を持っていない端末からは試させない（番号を知っているだけの第三者の総当たりを止める）
  if (!qrKeyOk(req, emp.qrKey)) return res.status(403).json(QR_KEY_REQUIRED_BODY);
  if (!emp.pin) return res.json({ ok: true, pinRequired: false });

  // 4桁（1万通り）なので、回数を制限しないと総当たりで当てられる。
  const now = Date.now();
  const empA = pinEmpAttempts.get(id);
  if (empA && empA.lockedUntil > now) {
    const minutes = Math.ceil((empA.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `暗証番号の間違いが続いたため、あと${minutes}分は入力できません。事務所に連絡してください。`, code: "locked", minutes, lockedUntil: new Date(empA.lockedUntil).toISOString() });
  }
  const key = `${id}|${req.header("cf-connecting-ip") || req.ip || "unknown"}`;
  for (const [k, a] of pinAttempts) {
    if (a.lockedUntil < now && now - a.firstFailureAt > PIN_WINDOW_MS) pinAttempts.delete(k);
  }
  const attempt = pinAttempts.get(key);
  if (attempt && attempt.lockedUntil > now) {
    const minutes = Math.ceil((attempt.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `暗証番号を続けて間違えたため、あと${minutes}分は入力できません。`, code: "locked", minutes, lockedUntil: new Date(attempt.lockedUntil).toISOString() });
  }

  const checked = verifyPin(String(pin ?? ""), emp.pin);
  const ok = checked.ok;
  if (!ok) {
    const e = empA && now - empA.firstFailureAt <= PIN_EMP_WINDOW_MS ? empA : { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    e.failures += 1;
    if (e.failures >= PIN_EMP_MAX) e.lockedUntil = now + PIN_EMP_WINDOW_MS;
    pinEmpAttempts.set(id, e);
    const a = attempt && now - attempt.firstFailureAt <= PIN_WINDOW_MS
      ? attempt
      : { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    a.failures += 1;
    if (a.failures >= PIN_MAX_FAILURES) a.lockedUntil = now + PIN_LOCK_MS;
    pinAttempts.set(key, a);
    return res.json({ ok: false, pinRequired: true });
  }
  pinAttempts.delete(key);
  pinEmpAttempts.delete(id);
  // 平文で保存されていたら、この機会に新しい形式で保存し直す（印の署名も新しい値で作る）
  let stored = emp.pin;
  if (checked.upgrade) {
    stored = hashSecret(String(pin));
    await db.update(employeesTable).set({ pin: stored }).where(eq(employeesTable.id, id));
  }
  // 合った端末に印を渡す。以後の打刻・履歴・メッセージの API はこの印を見て本人と判断する。
  issueDriverToken(res, id, stored);
  return res.json({ ok: true, pinRequired: true });
});

// PIN設定有無の確認（ドライバー用）
router.get("/employees/:id/pin/status", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [emp] = await db.select({ pin: employeesTable.pin, qrKey: employeesTable.qrKey }).from(employeesTable).where(eq(employeesTable.id, id));
  if (!emp) return res.status(404).json({ error: "社員が見つかりません。" });
  const verified = !!emp.pin && tokenValid(req, id, emp.pin);
  // 管理画面（ログイン済み）からは社員編集で「暗証番号が設定済みか」を見るのに使う
  if (!verified && !req.session?.userId && !qrKeyOk(req, emp.qrKey)) return res.status(403).json(QR_KEY_REQUIRED_BODY);
  // verified＝この端末は暗証番号を確かめ済み（開き直すたびに入れ直さなくてよい）
  return res.json({ pinSet: !!emp.pin, verified });
});

export default router;
