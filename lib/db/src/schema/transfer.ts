import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * 給与の振込（全銀協フォーマットでの書き出し）に使う口座。
 *
 * 社員の口座は社員マスターの「振込口座」タブで入れる。社員の表（employees）に列を足すと
 * 社員の一覧・QR打刻ページ（公開）の応答にまで口座が載ってしまうため、別の表に分けている。
 * 書き出しの形式は artifacts/api-server/src/lib/zengin.ts を参照。
 */
export const employeeBankAccountsTable = pgTable("employee_bank_accounts", {
  employeeId: integer("employee_id").primaryKey(),
  /** 銀行コード（4桁の数字）*/
  bankCode: text("bank_code").notNull().default(""),
  /** 銀行名（カナで入れると全銀の書き出しにも載る。漢字のときは書き出しでは空欄にする）*/
  bankName: text("bank_name").notNull().default(""),
  /** 支店コード（3桁の数字）*/
  branchCode: text("branch_code").notNull().default(""),
  branchName: text("branch_name").notNull().default(""),
  /** 預金種目 1=普通 2=当座 4=貯蓄 9=その他（全銀の規定の番号）*/
  accountType: integer("account_type").notNull().default(1),
  /** 口座番号（7桁まで。足りない分は書き出しで前に0を足す）*/
  accountNumber: text("account_number").notNull().default(""),
  /** 口座名義（カナ）*/
  holderKana: text("holder_kana").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 振込元（会社の口座）と委託者の設定。1行だけ使う（id=1）。 */
export const transferSettingsTable = pgTable("transfer_settings", {
  id: integer("id").primaryKey(),
  /** 委託者コード（銀行と契約したときに銀行から渡される10桁の番号）*/
  consignorCode: text("consignor_code").notNull().default(""),
  /** 委託者名（カナ）*/
  consignorName: text("consignor_name").notNull().default(""),
  bankCode: text("bank_code").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  branchCode: text("branch_code").notNull().default(""),
  branchName: text("branch_name").notNull().default(""),
  accountType: integer("account_type").notNull().default(1),
  accountNumber: text("account_number").notNull().default(""),
  /** 種別コード 11=給与振込 12=賞与振込 21=総合振込（銀行との契約に合わせて選ぶ）*/
  kindCode: text("kind_code").notNull().default("11"),
  /** 振込指定区分（データレコードの1けた。銀行の指定が無ければ空欄）*/
  designation: text("designation").notNull().default(""),
  /** 1件ごとに改行（CR+LF）を入れるか（銀行の指定に合わせる）*/
  newline: boolean("newline").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmployeeBankAccount = typeof employeeBankAccountsTable.$inferSelect;
export type TransferSettings = typeof transferSettingsTable.$inferSelect;
