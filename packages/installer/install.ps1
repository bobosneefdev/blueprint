# better-rust installer. Read it before you run it:
#   powershell -ExecutionPolicy ByPass -c "irm https://better-rust.pages.dev/install.ps1 | iex"
#
# What it does, in order:
#   1. Checks Windows 10 2004+/11 x64.
#   2. Makes sure WSL 2 is available (the AI agent runs inside a locked-down Linux sandbox).
#      If WSL is missing it runs `wsl --install --no-distribution`, which needs admin + a reboot.
#   3. Downloads the latest release from GitHub: the app installer and the sandbox image.
#   4. Checks every download against the SHA256 list published with the release.
#   5. Runs the app installer (per-user, no admin) and puts the sandbox image where the app finds it.
#
# It does NOT: touch Rust or Easy Anti-Cheat, read game memory, or send anything anywhere except
# GitHub (downloads). Source: https://github.com/bobosneefdev/better-rust

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "bobosneefdev/better-rust"
$Home_ = Join-Path $env:LOCALAPPDATA "better-rust"

function Say($msg) { Write-Host "better-rust: $msg" }

# 1. Platform
if (-not [Environment]::Is64BitOperatingSystem) { throw "better-rust needs 64-bit Windows." }
$build = [Environment]::OSVersion.Version.Build
if ($build -lt 19041) { throw "better-rust needs Windows 10 version 2004 (build 19041) or newer. You have build $build." }

# 2. WSL
$wslOk = $false
try {
  wsl.exe --status *> $null
  $wslOk = ($LASTEXITCODE -eq 0)
} catch { $wslOk = $false }

if (-not $wslOk) {
  Say "WSL is not set up. It's needed for the AI agent's sandbox."
  Say "Windows will ask for admin permission, then you'll need to restart and run this installer again."
  Start-Process wsl.exe -ArgumentList "--install", "--no-distribution" -Verb RunAs -Wait
  Say "Restart your PC, then run the same install command again."
  return
}

# 3. Download
Say "Finding the latest release..."
$release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "better-rust-installer" }
$assets = @{}
foreach ($a in $release.assets) { $assets[$a.name] = $a.browser_download_url }

$want = @("better-rust-setup.exe", "better-rust-agent.tar.gz", "SHA256SUMS")
foreach ($n in $want) { if (-not $assets.ContainsKey($n)) { throw "Release $($release.tag_name) is missing $n." } }

New-Item -ItemType Directory -Force -Path $Home_ | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("better-rust-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

foreach ($n in $want) {
  Say "Downloading $n..."
  Invoke-WebRequest $assets[$n] -OutFile (Join-Path $tmp $n) -UseBasicParsing
}

# 4. Verify
$sums = @{}
foreach ($line in Get-Content (Join-Path $tmp "SHA256SUMS")) {
  $parts = $line -split "\s+", 2
  if ($parts.Count -eq 2) { $sums[$parts[1].TrimStart("*")] = $parts[0].ToLower() }
}
foreach ($n in @("better-rust-setup.exe", "better-rust-agent.tar.gz")) {
  $actual = (Get-FileHash (Join-Path $tmp $n) -Algorithm SHA256).Hash.ToLower()
  if ($sums[$n] -ne $actual) { throw "Checksum mismatch for $n. Not installing." }
}
Say "Checksums OK ($($release.tag_name))."

# 5. Install
Move-Item -Force (Join-Path $tmp "better-rust-agent.tar.gz") (Join-Path $Home_ "better-rust-agent.tar.gz")
Say "Installing the app..."
Start-Process (Join-Path $tmp "better-rust-setup.exe") -ArgumentList "/S" -Wait
Remove-Item -Recurse -Force $tmp

Say "Done. better-rust is in your tray. Open it and click 'Connect Rust+' to sign in."
