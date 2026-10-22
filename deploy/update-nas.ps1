# 本番(NAS)へアップデートをデプロイする。
#
#   powershell -File deploy/update-nas.ps1                 # api と web の両方
#   powershell -File deploy/update-nas.ps1 -Only web       # フロント/nginx だけ変えたとき
#   powershell -File deploy/update-nas.ps1 -Only api       # バックエンドだけ変えたとき
#   powershell -File deploy/update-nas.ps1 -Rollback       # ひとつ前の版に戻す（:prev を :latest にして起動し直す）
#
# 何をするか:
#   1. 開発機で linux/amd64 のイメージをビルド（NAS は x86_64 の Synology。ビルドの中で型の確認もする）
#   2. docker save → gzip → scp で NAS へ転送
#   3. NAS で DB の控えを取り、DB の変更（deploy/migrations）の当て忘れが無いかを確かめる
#   4. いまの版を :prev として残してから docker load → docker compose up -d
#   5. インターネット経由で疎通を検証
#
# NAS へは鍵でつなぐ（~/.ssh/dreamticket_nas）。NAS の docker は `sudo -n /usr/local/bin/docker`
# だけパスワードなしで使える設定にしてある。以前はパスワードをコマンドの文字列に埋め込んで
# いたため、NAS のプロセス一覧や記録に残るおそれがあった。
# どこかで失敗したら、その場で止まる（以前は読み込みの失敗を警告だけにして先に進んでいた）。

[CmdletBinding()]
param(
  [ValidateSet("both", "api", "web")]
  [string]$Only = "both",

  [string]$NasHost = "192.168.0.199",
  [string]$NasUser = "kotaki",
  [string]$KeyFile = (Join-Path $HOME ".ssh\dreamticket_nas"),

  # QRコードが指す公開ホスト（ドライバーの打刻ページ）
  [string]$PublicOrigin = "https://mikawa-unso.jp",

  # NAS 上の compose ディレクトリ
  [string]$RemoteDir = "/volume2/docker/mikawa-system/app/deploy",

  [switch]$Rollback,
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $env:TEMP "mikawa-deploy"
$transfer = "/volume2/docker/mikawa-system/transfer"
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$sshArgs = @("-i", $KeyFile, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes")
function Invoke-Nas([string]$Command) {
  $out = & ssh.exe @sshArgs "$NasUser@$NasHost" $Command 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host $out; throw "NAS で失敗しました: $Command" }
  return $out
}
$DK = "sudo -n /usr/local/bin/docker"
$DC = "cd $RemoteDir && $DK compose"
$targets = if ($Only -eq "both") { @("api", "web") } else { @($Only) }

if ($Rollback) {
  Write-Host "==> ひとつ前の版に戻します: $($targets -join ', ')" -ForegroundColor Yellow
  foreach ($t in $targets) { Invoke-Nas "$DK image inspect mikawa-${t}:prev > /dev/null && $DK tag mikawa-${t}:prev mikawa-${t}:latest" | Out-Null }
  Invoke-Nas "$DC up -d --force-recreate $($targets -join ' ') 2>&1 | tail -4"
  Write-Host "戻しました。DB の変更を当てた後だった場合は、前の版がその列を使わないかに注意（足しただけの列なら問題ない）。" -ForegroundColor Yellow
  exit 0
}

Push-Location $repo
try {
  # ── 0. DB の変更の当て忘れを先に確かめる ──────────────────
  $local = Get-ChildItem (Join-Path $repo "deploy/migrations") -Filter *.sql | ForEach-Object { $_.Name } | Sort-Object
  $applied = Invoke-Nas "$DK exec mikawa-system-db-1 sh -c 'psql -At -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -c `"select name from schema_migrations`"' 2>/dev/null || true"
  $missing = @($local | Where-Object { $applied -notcontains $_ -and $_ -ge "2026-10-14" })
  if ($missing.Count -gt 0) {
    throw "当てていない DB の変更があります: $($missing -join ', ')。deploy/README.md の「DB の変更」の手順で先に当ててください（新しい api は当て忘れを見つけると起動しません）。"
  }

  # ── 1. ビルド ─────────────────────────────────────────────
  foreach ($t in $targets) {
    Write-Host "==> ビルド: mikawa-$t (linux/amd64)" -ForegroundColor Cyan
    $buildArgs = @("build", "--platform", "linux/amd64", "-f", "deploy/Dockerfile",
                   "--target", $t, "-t", "mikawa-${t}:latest")
    if ($t -eq "web") { $buildArgs += @("--build-arg", "VITE_PUBLIC_ORIGIN=$PublicOrigin") }
    $buildArgs += "."
    & docker @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "docker build ($t) が失敗しました" }
  }

  # ── 2. 保存 → 転送 ──────────────────────────────────────
  # Windows PowerShell 5.1 の `|` はバイナリを壊すので、.tar に書き出してから .NET で gzip する。
  $raw = Join-Path $staging "mikawa-images.tar"
  $tar = Join-Path $staging "mikawa-images.tar.gz"
  Write-Host "==> イメージを保存中..." -ForegroundColor Cyan
  $imgs = @($targets | ForEach-Object { "mikawa-${_}:latest" })
  & docker @(@("save", "-o", $raw) + $imgs)
  if ($LASTEXITCODE -ne 0) { throw "docker save が失敗しました" }
  $in = [IO.File]::OpenRead($raw); $out = [IO.File]::Create($tar)
  $gz = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Fastest)
  try { $in.CopyTo($gz) } finally { $gz.Dispose(); $out.Dispose(); $in.Dispose() }
  Remove-Item $raw -Force
  Write-Host ("    {0} MB" -f [math]::Round((Get-Item $tar).Length / 1MB, 1))

  Write-Host "==> NAS へ転送中..." -ForegroundColor Cyan
  Invoke-Nas "mkdir -p $transfer" | Out-Null
  & scp.exe -O @sshArgs $tar "${NasUser}@${NasHost}:$transfer/mikawa-images.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw "転送に失敗しました" }

  # ── 3. 控え → 前の版を残す → 読み込み → 差し替え ─────────────
  Write-Host "==> DB の控えを取っています..." -ForegroundColor Cyan
  $stamp = Get-Date -Format "yyyyMMdd-HHmm"
  Invoke-Nas "$DK exec mikawa-system-db-1 sh -c 'pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`"' | gzip > $transfer/before-deploy-$stamp.sql.gz && test -s $transfer/before-deploy-$stamp.sql.gz" | Out-Null
  foreach ($t in $targets) { Invoke-Nas "$DK image inspect mikawa-${t}:latest > /dev/null 2>&1 && $DK tag mikawa-${t}:latest mikawa-${t}:prev || true" | Out-Null }
  Write-Host "==> NAS でイメージを読み込み中..." -ForegroundColor Cyan
  Invoke-Nas "gunzip -c $transfer/mikawa-images.tar.gz | $DK load"
  Write-Host "==> コンテナを差し替え中..." -ForegroundColor Cyan
  Invoke-Nas "$DC up -d --force-recreate $($targets -join ' ') 2>&1 | tail -4"
  Invoke-Nas "rm -f $transfer/mikawa-images.tar.gz" | Out-Null

  # 稼働確認（healthcheck）が通るまで待つ
  Write-Host "==> 稼働確認を待っています..." -ForegroundColor Cyan
  $healthy = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 3
    $st = Invoke-Nas "$DK inspect -f '{{.State.Health.Status}}' mikawa-system-api-1"
    if ("$st".Trim() -eq "healthy") { $healthy = $true; break }
  }
  Invoke-Nas "$DC ps -a 2>/dev/null | tail -6"
  if (-not $healthy) { throw "api が起動しません。`$DK logs mikawa-system-api-1 を見て、直せなければ -Rollback で戻してください。" }
}
finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Pop-Location
}

# ── 4. 検証（インターネット経由）────────────────────────────
if (-not $SkipVerify) {
  Write-Host "`n==> 疎通検証（インターネット経由）" -ForegroundColor Cyan
  # 公開ホストは QR だけが通り、管理画面と管理APIは塞がれていること。
  $checks = @(
    @{ url = "https://mikawa-unso.jp/driver/25";        expect = 200; note = "QRの画面は開く" },
    @{ url = "https://mikawa-unso.jp/api/employees/25"; expect = 403; note = "合言葉の無い要求は断る" },
    @{ url = "https://mikawa-unso.jp/api/auth/login";   expect = 403; note = "ログインAPIは非公開" },
    @{ url = "https://mikawa-unso.jp/api/payroll";      expect = 403; note = "給与APIは非公開" },
    @{ url = "https://mikawa-unso.jp/";                 expect = 302; note = "管理画面へ転送" },
    @{ url = "https://admin.mikawa-unso.jp/";           expect = 200; note = "ログイン画面" },
    @{ url = "https://admin.mikawa-unso.jp/api/payroll?year=2026&month=1"; expect = 401; note = "ログインなしは断る" },
    @{ url = "https://admin.mikawa-unso.jp/api/calendar/overrides";        expect = 401; note = "カレンダーもログインが要る" },
    @{ url = "https://admin.mikawa-unso.jp/api/healthz"; expect = 200; note = "DB まで届く" }
  )
  $ng = 0
  foreach ($c in $checks) {
    $code = 0
    try {
      $out = & curl.exe -s -o NUL -w "%{http_code}" --max-time 25 -A "Mozilla/5.0" $c.url 2>$null
      $code = [int]($out | Select-Object -First 1)
    } catch { $code = 0 }
    $ok = ($code -eq $c.expect)
    if (-not $ok) { $ng++ }
    $mark = if ($ok) { "OK" } else { "NG" }
    Write-Host ("  [{0}] {1,-60} 期待{2} 実際{3}  {4}" -f $mark, $c.url, $c.expect, $code, $c.note) `
      -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
  }
  if ($ng -gt 0) { throw "$ng 件の検証に失敗しました。直せなければ -Rollback で戻してください。" }
  Write-Host "`n完了: 全ての検証に合格しました。" -ForegroundColor Green
} else {
  Write-Host "`n完了（検証はスキップ）。" -ForegroundColor Green
}
