# 2026-09-14 リリース（保険料率・標準報酬月額の履歴）。NAS のパスワードを1回だけ聞いて、
#   1. DB に新しいテーブル2つと payrolls の列（null 可）を追加（追加のみ。既存データは変わらない）
#   2. deploy/update-nas.ps1 で api / web のイメージを入れ替え＋インターネット経由の疎通検証
# を順に実行する。1 が失敗したらイメージは入れ替えないので、本番は今のまま。
#
# 使い方（リポジトリのルート C:\dev\mikawaunsou で）:
#   powershell -ExecutionPolicy Bypass -File deploy\release-2026-09-14-insurance.ps1

$ErrorActionPreference = "Stop"

if (-not (Test-Path "deploy/update-nas.ps1")) {
  throw "リポジトリのルート（C:\dev\mikawaunsou）で実行してください。"
}

$sec   = Read-Host "NAS (kotaki@192.168.0.199) のパスワード" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
           [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$cred  = New-Object System.Management.Automation.PSCredential("kotaki", $sec)

Import-Module Posh-SSH -ErrorAction Stop
$session = New-SSHSession -ComputerName 192.168.0.199 -Credential $cred -AcceptKey
$sid = $session.SessionId

$PSQL = "echo '" + $plain + "' | sudo -S /usr/local/bin/docker exec mikawa-system-db-1 psql -U mikawa -d mikawa -v ON_ERROR_STOP=1"

# SQL は base64 にして NAS のシェルで戻し、-c で渡す。
# 標準入力は sudo -S のパスワードに使うので、SQL を標準入力（here-doc）で渡すと
# sudo が SQL の1行目をパスワードとして読んでしまう。
function Invoke-Sql([string]$Sql, [string]$Opts = "") {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sql))
  $c = $PSQL + " " + $Opts + " -c " + '"$(echo ' + $b64 + ' | base64 -d)"'
  return Invoke-SSHCommand -SessionId $script:sid -Command $c -TimeOut 180
}

# lib/db/src/schema/insurance.ts・payrolls.ts と同じ定義（drizzle の制約名に合わせる）
$ddl = @'
BEGIN;
CREATE TABLE IF NOT EXISTS insurance_rate_periods (
  id serial PRIMARY KEY,
  effective_year integer NOT NULL,
  effective_month integer NOT NULL,
  health_insurance_rate double precision NOT NULL,
  care_insurance_rate double precision NOT NULL,
  childcare_support_rate double precision NOT NULL,
  pension_rate double precision NOT NULL,
  employment_insurance_rate double precision NOT NULL,
  pension_max_standard integer NOT NULL DEFAULT 650000,
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT insurance_rate_periods_effective_unique UNIQUE (effective_year, effective_month)
);
CREATE TABLE IF NOT EXISTS standard_remuneration_history (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL,
  effective_year integer NOT NULL,
  effective_month integer NOT NULL,
  amount double precision NOT NULL,
  reason text NOT NULL DEFAULT 'teiji',
  note text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT standard_remuneration_history_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT standard_remuneration_history_emp_effective_unique UNIQUE (employee_id, effective_year, effective_month)
);
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS applied_standard_remuneration double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS applied_health_insurance_rate double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS applied_care_insurance_rate double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS applied_childcare_support_rate double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS applied_pension_rate double precision;
ALTER TABLE payrolls ADD COLUMN IF NOT EXISTS applied_employment_insurance_rate double precision;
COMMIT;
'@

Write-Host "==> 1/2 DB にテーブルと列を追加" -ForegroundColor Cyan
$r = Invoke-Sql $ddl
$r.Output | ForEach-Object { "    $($_ -replace '^Password: ','')" }
if ($r.ExitStatus -ne 0) {
  $r.Error | ForEach-Object { "    ERR: $_" }
  Remove-SSHSession -SessionId $sid | Out-Null
  throw "DB の変更に失敗しました。イメージは入れ替えていません（本番は今のまま）。"
}

$check = "select string_agg(table_name, ',') from information_schema.tables where table_name in ('insurance_rate_periods','standard_remuneration_history'); select count(*) from information_schema.columns where table_name='payrolls' and column_name like 'applied_%';"
$v = Invoke-Sql $check "-t -A"
$lines = @($v.Output | ForEach-Object { $_ -replace '^Password: ','' } | Where-Object { $_ -match '\S' })
"    テーブル: $($lines[0]) / payrolls の applied_* 列: $($lines[1])"
Remove-SSHSession -SessionId $sid | Out-Null
if ($lines[1] -ne "6") { throw "列の追加を確認できませんでした。イメージは入れ替えていません。" }

Write-Host "==> 2/2 イメージを入れ替え（api と web）" -ForegroundColor Cyan
$env:NAS_PASSWORD = $plain
try {
  & powershell -ExecutionPolicy Bypass -File "deploy/update-nas.ps1"
  if ($LASTEXITCODE -ne 0) { throw "update-nas.ps1 が失敗しました（exit $LASTEXITCODE）。" }
} finally {
  Remove-Item Env:NAS_PASSWORD -ErrorAction SilentlyContinue
}
Write-Host "完了しました。" -ForegroundColor Green
