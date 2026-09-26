# 本番(NAS)へアップデートをデプロイする。
#
#   powershell -File deploy/update-nas.ps1                 # api と web の両方
#   powershell -File deploy/update-nas.ps1 -Only web       # フロント/nginx だけ変えたとき
#   powershell -File deploy/update-nas.ps1 -Only api       # バックエンドだけ変えたとき
#   powershell -File deploy/update-nas.ps1 -Rollback       # 直前の版に戻す（ビルドしない）
#   powershell -File deploy/update-nas.ps1 -Rollback -Only api
#
# 何をするか:
#   1. 開発機で linux/amd64 のイメージをビルド（NAS は x86_64 の Synology）
#   2. docker save | gzip → SCP で NAS へ転送
#   3. NAS で docker load → docker compose up -d
#   4. インターネット経由で疎通を検証
#
# NAS 上でビルドしないのは、Celeron の NAS でモノレポをビルドし直すより
# 「開発機で検証したイメージをそのまま動かす」方が確実で速いため。
#
# 戻し方の仕組み:
#   - NAS に読み込む前に、いま動いている mikawa-<api|web>:latest を :prev として残す。
#   - イメージには git のコミット（例 mikawa-api:a1cf97f）も付けるので、どの版が動いているか分かる。
#     NAS 上のコミット付きタグは直近 5 版だけ残す。
#   - -Rollback は :prev を :latest に付け替えて作り直すだけ。DB は触らない
#     （スキーマを変えたリリースを戻すときは、DB 側の扱いを別途考えること）。
#   - -Rollback を続けて2回実行しても2つ前には戻らない（:prev は1つだけ）。
#     もっと前の版に戻したいときは NAS で `docker tag mikawa-api:<sha> mikawa-api:latest` してから
#     `docker compose up -d --force-recreate api`。
#
# パスワードは環境変数 NAS_PASSWORD で渡す（未設定なら対話で聞く）:
#   $env:NAS_PASSWORD = "..."   ; powershell -File deploy/update-nas.ps1

[CmdletBinding()]
param(
  [ValidateSet("both", "api", "web")]
  [string]$Only = "both",

  [string]$NasHost = "192.168.0.199",
  [string]$NasUser = "kotaki",

  # QRコードが指す公開ホスト。admin を入れるとドライバーが Access に弾かれる。
  [string]$PublicOrigin = "https://mikawa-unso.jp",

  # NAS 上の compose ディレクトリ
  [string]$RemoteDir = "/volume2/docker/mikawa-system/app/deploy",

  [switch]$SkipVerify,

  # 直前の版（:prev）に戻す。ビルド・転送はしない。
  [switch]$Rollback
)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $env:TEMP "mikawa-deploy"
New-Item -ItemType Directory -Force -Path $staging | Out-Null

# ── 認証情報 ──────────────────────────────────────────────
if ($env:NAS_PASSWORD) {
  $secure = ConvertTo-SecureString $env:NAS_PASSWORD -AsPlainText -Force
} else {
  $secure = Read-Host "NAS ($NasUser@$NasHost) のパスワード" -AsSecureString
}
$cred = New-Object System.Management.Automation.PSCredential($NasUser, $secure)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

Import-Module Posh-SSH -ErrorAction Stop

# NAS の docker は /usr/local/bin にあり、kotaki は docker グループ非所属なので sudo が要る
$DC = "cd $RemoteDir && echo '$plain' | sudo -S /usr/local/bin/docker compose"
$DK = "echo '$plain' | sudo -S /usr/local/bin/docker"

function Invoke-Nas([string]$Command, [int]$Timeout = 900) {
  $r = Invoke-SSHCommand -SessionId $script:sid -Command $Command -TimeOut $Timeout
  if ($r.ExitStatus -ne 0 -and $r.Error) { Write-Warning $r.Error }
  return $r.Output
}

$targets = if ($Only -eq "both") { @("api", "web") } else { @($Only) }

Push-Location $repo
try {
  if ($Rollback) {
    # ── 戻す ────────────────────────────────────────────────
    $session = New-SSHSession -ComputerName $NasHost -Credential $cred -AcceptKey
    $script:sid = $session.SessionId
    foreach ($t in $targets) {
      $prevId = Invoke-Nas "$DK image inspect mikawa-${t}:prev --format '{{.Id}}' 2>/dev/null"
      if (-not $prevId) { throw "mikawa-${t}:prev が NAS にありません（この仕組みを入れてから一度もデプロイしていない）。" }
      Write-Host "==> mikawa-${t}: 直前の版（:prev）に戻します" -ForegroundColor Yellow
      Invoke-Nas "$DK tag mikawa-${t}:prev mikawa-${t}:latest" | Out-Null
    }
    Write-Host "==> コンテナを差し替え中..." -ForegroundColor Cyan
    Invoke-Nas "$DC up -d --force-recreate $($targets -join ' ') 2>&1 | tail -4"
  } else {
    # ── 1. ビルド ─────────────────────────────────────────
    $sha = (& git rev-parse --short HEAD).Trim()
    if (& git status --porcelain) {
      $sha = "$sha-dirty"
      Write-Warning "コミットしていない変更があります。イメージのタグは $sha になります。"
    }
    foreach ($t in $targets) {
      Write-Host "==> ビルド: mikawa-$t (linux/amd64) 版 $sha" -ForegroundColor Cyan
      # $args は PowerShell の自動変数なので使わない（$buildArgs にする）
      $buildArgs = @("build", "--platform", "linux/amd64", "-f", "deploy/Dockerfile",
                     "--target", $t, "-t", "mikawa-${t}:latest", "-t", "mikawa-${t}:$sha")
      if ($t -eq "web") { $buildArgs += @("--build-arg", "VITE_PUBLIC_ORIGIN=$PublicOrigin") }
      $buildArgs += "."
      & docker @buildArgs
      if ($LASTEXITCODE -ne 0) { throw "docker build ($t) が失敗しました" }
    }

    # ── 2. 保存 → 転送 ────────────────────────────────────
    # 注意: Windows PowerShell 5.1 の `|` はバイナリを壊す（テキストとして扱われる）。
    #       `docker save | gzip` はやらず、いったん .tar に書き出してから .NET で gzip する。
    $raw = Join-Path $staging "mikawa-images.tar"
    $tar = Join-Path $staging "mikawa-images.tar.gz"
    Write-Host "==> イメージを保存中..." -ForegroundColor Cyan
    # @() で必ず配列にする。対象が1つのときスカラー文字列になり、splat が文字単位に
    # バラけて "No such image: m:latest" になる。
    $imgs = @($targets | ForEach-Object { "mikawa-${_}:latest"; "mikawa-${_}:$sha" })
    $saveArgs = @("save", "-o", $raw) + $imgs
    & docker @saveArgs
    if ($LASTEXITCODE -ne 0) { throw "docker save が失敗しました" }

    $in  = [IO.File]::OpenRead($raw)
    $out = [IO.File]::Create($tar)
    $gz  = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Fastest)
    try { $in.CopyTo($gz) } finally { $gz.Dispose(); $out.Dispose(); $in.Dispose() }
    Remove-Item $raw -Force

    $mb = [math]::Round((Get-Item $tar).Length / 1MB, 1)
    Write-Host "    $mb MB"

    Write-Host "==> NAS へ転送中..." -ForegroundColor Cyan
    $session = New-SSHSession -ComputerName $NasHost -Credential $cred -AcceptKey
    $script:sid = $session.SessionId
    Invoke-Nas "mkdir -p /volume2/docker/mikawa-system/transfer" | Out-Null
    Set-SCPItem -ComputerName $NasHost -Credential $cred -Path $tar `
                -Destination "/volume2/docker/mikawa-system/transfer" -AcceptKey -Force | Out-Null

    # ── 3. NAS 側で反映 ───────────────────────────────────
    # 読み込むと :latest が新しい版に付け替わるので、その前にいまの版を :prev として残す（戻し用）
    foreach ($t in $targets) {
      Invoke-Nas "$DK image inspect mikawa-${t}:latest >/dev/null 2>&1 && $DK tag mikawa-${t}:latest mikawa-${t}:prev" | Out-Null
    }
    Write-Host "==> NAS でイメージを読み込み中..." -ForegroundColor Cyan
    Invoke-Nas "$DK load -i /volume2/docker/mikawa-system/transfer/mikawa-images.tar.gz 2>&1 | grep Loaded"

    Write-Host "==> コンテナを差し替え中..." -ForegroundColor Cyan
    Invoke-Nas "$DC up -d --force-recreate $($targets -join ' ') 2>&1 | tail -4"
    Invoke-Nas "rm -rf /volume2/docker/mikawa-system/transfer" | Out-Null

    # コミット付きのタグは直近 5 版だけ残す（:latest と :prev が指す中身は、タグを外しても残る）
    foreach ($t in $targets) {
      Invoke-Nas ("$DK images mikawa-${t} --format '{{.CreatedAt}}|{{.Tag}}' | grep -vE '\|(latest|prev)$' | sort -r | tail -n +6 | cut -d'|' -f2 " +
                  "| while read tag; do $DK rmi mikawa-${t}:`$tag >/dev/null 2>&1; done") | Out-Null
    }
    Write-Host "==> 反映した版: $sha （戻すときは -Rollback）" -ForegroundColor Cyan
  }

  Start-Sleep -Seconds 6
  Write-Host "==> 稼働状況" -ForegroundColor Cyan
  Invoke-Nas "$DC ps -a 2>/dev/null | tail -6"
}
finally {
  if ($script:sid -ne $null) { Remove-SSHSession -SessionId $script:sid | Out-Null }
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
  Pop-Location
}

# ── 4. 検証（インターネット経由）────────────────────────────
if (-not $SkipVerify) {
  Write-Host "`n==> 疎通検証（インターネット経由）" -ForegroundColor Cyan
  # 公開ホストは QR だけが通り、管理画面と管理APIは塞がれていること。
  # 管理ホストは Cloudflare Access のログインへ飛ぶこと。
  $checks = @(
    @{ url = "https://mikawa-unso.jp/driver/25";        expect = 200; note = "QRは開く" },
    @{ url = "https://mikawa-unso.jp/api/employees/25"; expect = 200; note = "打刻APIは通る" },
    @{ url = "https://mikawa-unso.jp/api/auth/login";   expect = 403; note = "ログインAPIは非公開" },
    @{ url = "https://mikawa-unso.jp/api/payroll";      expect = 403; note = "給与APIは非公開" },
    @{ url = "https://mikawa-unso.jp/";                 expect = 302; note = "管理画面へ転送" },
    # Cloudflare Access は 2026-07-15 に撤去した（ユーザー判断）。
    # 管理ホストはアプリ自身のログイン画面を直接返す（総当たり対策は
    # routes/auth.ts のレート制限で担保）。
    @{ url = "https://admin.mikawa-unso.jp/";           expect = 200; note = "ログイン画面" }
  )
  # Windows PowerShell 5.1 には -SkipHttpErrorCheck が無く、Invoke-WebRequest は
  # 4xx/3xx で例外を投げる。素直に curl.exe（Win10 以降に同梱）でステータスだけ取る。
  $ng = 0
  foreach ($c in $checks) {
    $code = 0
    try {
      $out = & curl.exe -s -o NUL -w "%{http_code}" --max-time 25 $c.url 2>$null
      $code = [int]($out | Select-Object -First 1)
    } catch { $code = 0 }
    $ok = ($code -eq $c.expect)
    if (-not $ok) { $ng++ }
    $mark = if ($ok) { "OK" } else { "NG" }
    Write-Host ("  [{0}] {1,-45} 期待{2} 実際{3}  {4}" -f $mark, $c.url, $c.expect, $code, $c.note) `
      -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
  }
  if ($ng -gt 0) {
    $hint = if ($Rollback) { "" } else { " 戻すときは: powershell -File deploy/update-nas.ps1 -Rollback -Only $Only" }
    throw "$ng 件の検証に失敗しました。deploy/README.md のトラブルシュートを参照。$hint"
  }
  Write-Host "`n完了: 全ての検証に合格しました。" -ForegroundColor Green
} else {
  Write-Host "`n完了（検証はスキップ）。" -ForegroundColor Green
}
