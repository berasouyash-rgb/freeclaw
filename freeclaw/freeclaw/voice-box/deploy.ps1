# ============================================================
#  Voice Flow - One-Click Production Deploy
#  Run with:  powershell -ExecutionPolicy Bypass -File deploy.ps1
#  or right-click -> "Run with PowerShell"
# ============================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Say($msg)  { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    [OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

Say "Voice Flow - Production Deploy"
Say "Working directory: $root"

# ---- 0. Preflight: node + npx available? --------------------
Say "Preflight checks"
try { $nodeVer = (node --version 2>$null) } catch { $nodeVer = '' }
if (-not $nodeVer) { Fail "Node.js not found on PATH. Install from https://nodejs.org" }
Ok "Node.js $nodeVer"

try { $npxVer = (npx --version 2>$null) } catch { $npxVer = '' }
if (-not $npxVer) { Fail "npx not found on PATH." }
Ok "npx $npxVer"

# ---- 1. Install dependencies if needed -----------------------
if (-not (Test-Path "$root\node_modules")) {
    Say "Installing dependencies (first run - this may take a few minutes)"
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm ci failed" }
    Ok "dependencies installed"
} else {
    Ok "node_modules present (skip install)"
}

# ---- 2. Vercel auth preflight (BEFORE deploying) --------------
Say "Vercel authentication check"
& npx --yes vercel whoami 2>$null
if ($LASTEXITCODE -ne 0) {
    Warn "Not logged in to Vercel."
    Warn "Run 'npx vercel login' in this folder first, then re-run this script."
    Fail "Vercel login required."
}
Ok "Vercel authenticated"

# ---- 3. Build + typecheck (canonical project command) ----------
Say "Build + typecheck (npm run build = tsc -b && vite build)"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed - fix errors before deploying" }
Ok "build complete"
if (Test-Path "$root\dist\health-chunks.json") {
    $hb = (Get-Item "$root\dist\health-chunks.json").Length
    Ok "health-chunks.json generated ($hb bytes)"
} else {
    Warn "health-chunks.json NOT found in dist - Error Tracking chunk panel will show 'not found'"
}

# ---- 4. Vercel production deploy -------------------------------
Say "Deploying to Vercel PRODUCTION"
& npx --yes vercel --prod --yes
if ($LASTEXITCODE -ne 0) { Fail "Vercel deploy failed (exit $LASTEXITCODE)" }

Say "Deploy complete! "
Ok "Live site: https://voice-box-psi.vercel.app/"
Warn "Verify: open /health-chunks.json (should return JSON, not HTML) and /admin (sidebar shows Leaderboard + Error Tracking)"
