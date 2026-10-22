// 試験の実行（依存を足さない）：各パッケージの test/*.test.ts を esbuild で1本の .mjs にまとめ、node --test で動かす。
// esbuild は api-server がすでに持っているものを借りる。
import { createRequire } from "node:module";
import { readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "artifacts/api-server/package.json"));
const { build } = require("esbuild");

const dirs = ["lib/tax-tables-reiwa8/test", "artifacts/api-server/test"].map((d) => join(root, d)).filter(existsSync);
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".test.ts")).map((f) => join(d, f)));
const out = mkdtempSync(join(tmpdir(), "mikawa-test-"));
const outs = [];
for (const f of files) {
  const o = join(out, f.replace(root, "").replace(/[\/:]/g, "_").replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [f], outfile: o, bundle: true, platform: "node", format: "esm", logLevel: "error",
    alias: { "@": join(root, "artifacts/payroll-app/src"), "@workspace/api-client-react": join(root, "scripts/test-stubs/api-client-react.mjs") },
    // DB には触らない試験だけをここに置く。DB を読むモジュールを誤って取り込んだら止める
    external: ["pg", "@workspace/db", "drizzle-orm", "drizzle-orm/*"],
  });
  outs.push(o);
}
const r = spawnSync(process.execPath, ["--test", ...outs], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
