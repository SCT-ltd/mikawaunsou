import { readFileSync } from "fs";
import xlsx from "xlsx";
import { db, pool } from "../lib/db/src/index";
import {
  companyTable,
  employeesTable,
  allowanceDefinitionsTable,
  employeeAllowancesTable,
  deductionDefinitionsTable,
  employeeDeductionsTable,
  monthlyRecordsTable,
  payrollsTable,
  messagesTable,
} from "../lib/db/src/schema";

const wb = xlsx.readFile("./三川運送_全データエクスポート.xlsx");

// Helper to convert 't' / 'f' strings to boolean
function toBool(val: any): boolean | undefined {
  if (val === "t") return true;
  if (val === "f") return false;
  if (val === true || val === false) return val;
  return undefined;
}

// Helper to convert string to number, empty string to null or undefined
function toNum(val: any): number | null {
  if (val === "" || val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

// Helper to parse dates
function toDate(val: any): Date | null {
  if (!val) return null;
  return new Date(val);
}

// Generic mapper that handles string formatting from DB exports
function mapRow(row: any) {
  const mapped: any = {};
  for (const [key, value] of Object.entries(row)) {
    // Boolean columns
    if (value === "t" || value === "f") {
      mapped[key] = value === "t";
      continue;
    }
    // Number check (if string contains only digits and optional decimal)
    if (typeof value === "string" && value !== "" && !isNaN(Number(value)) && !key.endsWith("_at") && key !== "employee_code" && key !== "pin" && key !== "name" && key !== "name_kana") {
      mapped[key] = Number(value);
      continue;
    }
    // Date check
    if (typeof value === "string" && (key.endsWith("_at") || key === "hire_date" || key === "date_of_birth")) {
      if (value === "") {
        mapped[key] = null;
      } else {
        mapped[key] = new Date(value);
      }
      continue;
    }
    if (value === "") {
      mapped[key] = null;
      // Some text columns in DB are NOT NULL and expect empty string instead of null.
      // So let's just keep the empty string if it's not a known date/number column.
      if (!key.endsWith("_at") && key !== "hire_date" && key !== "date_of_birth" && !key.includes("rate") && !key.includes("hours") && !key.includes("amount") && !key.includes("pay") && !key.includes("deduction") && !key.includes("count") && !key.includes("salary") && !key.includes("distance") && !key.includes("cases") && !key.includes("days")) {
        mapped[key] = "";
      }
      continue;
    }
    mapped[key] = value;
  }
  
  // Specific mappings for snake_case to camelCase used in DB inserts
  const finalObj: any = {};
  for (const [key, value] of Object.entries(mapped)) {
    const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
    finalObj[camelKey] = value;
  }
  return finalObj;
}

async function run() {
  console.log("Starting data import...");

  try {
    // 1. 会社設定
    const companyData = xlsx.utils.sheet_to_json(wb.Sheets["会社設定"]);
    if (companyData.length > 0) {
      await db.insert(companyTable).values(companyData.map(mapRow)).onConflictDoNothing();
      console.log("Inserted 会社設定");
    }

    // 2. 従業員マスタ
    const employeesData = xlsx.utils.sheet_to_json(wb.Sheets["従業員マスタ"]);
    if (employeesData.length > 0) {
      await db.insert(employeesTable).values(employeesData.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${employeesData.length} 従業員`);
    }

    // 3. 手当定義
    const allowanceDefs = xlsx.utils.sheet_to_json(wb.Sheets["手当定義"]);
    if (allowanceDefs.length > 0) {
      await db.insert(allowanceDefinitionsTable).values(allowanceDefs.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${allowanceDefs.length} 手当定義`);
    }

    // 4. 控除定義
    const deductionDefs = xlsx.utils.sheet_to_json(wb.Sheets["控除定義"]);
    if (deductionDefs.length > 0) {
      await db.insert(deductionDefinitionsTable).values(deductionDefs.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${deductionDefs.length} 控除定義`);
    }

    // 5. 従業員手当
    const empAllowances = xlsx.utils.sheet_to_json(wb.Sheets["従業員手当"]);
    if (empAllowances.length > 0) {
      await db.insert(employeeAllowancesTable).values(empAllowances.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${empAllowances.length} 従業員手当`);
    }

    // 6. 従業員控除
    const empDeductions = xlsx.utils.sheet_to_json(wb.Sheets["従業員控除"]);
    if (empDeductions.length > 0) {
      await db.insert(employeeDeductionsTable).values(empDeductions.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${empDeductions.length} 従業員控除`);
    }

    // 7. 月次実績
    const monthlyRecords = xlsx.utils.sheet_to_json(wb.Sheets["月次実績"]);
    if (monthlyRecords.length > 0) {
      await db.insert(monthlyRecordsTable).values(monthlyRecords.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${monthlyRecords.length} 月次実績`);
    }

    // 8. 給与明細
    const payrolls = xlsx.utils.sheet_to_json(wb.Sheets["給与明細"]);
    if (payrolls.length > 0) {
      await db.insert(payrollsTable).values(payrolls.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${payrolls.length} 給与明細`);
    }

    // 9. メッセージ
    const messages = xlsx.utils.sheet_to_json(wb.Sheets["メッセージ"]);
    if (messages.length > 0) {
      await db.insert(messagesTable).values(messages.map(mapRow)).onConflictDoNothing();
      console.log(`Inserted ${messages.length} メッセージ`);
    }

    console.log("Import completed successfully!");
  } catch (error) {
    console.error("Error during import:", error);
  } finally {
    pool.end();
  }
}

run();
