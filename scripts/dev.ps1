# Local dev launcher (replaces the Replit run button).
# Loads .env.local, then starts the api-server (build+run) and the Vite dev server.
# Usage:  pwsh -File scripts/dev.ps1        (from the repo root)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

# --- load .env.local ---
$envFile = Join-Path $root ".env.local"
if (-not (Test-Path $envFile)) { throw ".env.local not found at $envFile" }
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { return }
  $name = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  Set-Item -Path "Env:$name" -Value $value
}

# --- api-server: build then start on $PORT (default 8080) ---
Push-Location (Join-Path $root "artifacts/api-server")
pnpm run build
Start-Process -FilePath "node" -ArgumentList "--enable-source-maps", "./dist/index.mjs" -NoNewWindow
Pop-Location

# --- payroll-app: Vite dev server on FRONT_PORT (default 5173) ---
$env:PORT = if ($env:FRONT_PORT) { $env:FRONT_PORT } else { "5173" }
Push-Location (Join-Path $root "artifacts/payroll-app")
pnpm run dev
Pop-Location
