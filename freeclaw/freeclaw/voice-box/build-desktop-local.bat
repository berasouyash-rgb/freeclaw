@echo off
REM Build the Windows desktop EXE locally (double-click, no commands to type).
REM Needs: Node 22+, ~1GB free (uses D:\Temp\opencode for caches), internet.
REM Output: electron\dist\Voice-Box-Desktop-*-win-x64.exe
cd /d "%~dp0"
echo Working in: %CD%
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node 22 LTS first.
  pause
  exit /b 1
)
node --version
REM Keep caches off the full C: drive.
set npm_config_cache=D:\Temp\opencode\npm-cache
set TEMP=D:\Temp\opencode
set TMP=D:\Temp\opencode
if not exist "D:\Temp\opencode" mkdir "D:\Temp\opencode"
REM The API address baked into the app. ALWAYS pinned here: an old system-wide
REM VITE_API_BASE (e.g. the dead voice-box.vercel.app domain) must never win
REM over this, or the build silently points at a server with no API again.
set VITE_API_BASE=https://voice-box-psi.vercel.app
echo API address baked in: %VITE_API_BASE%
REM Realtime needs the Supabase URL + anon key BAKED at build time (vite
REM inlines import.meta.env at compile time; the EXE cannot read them
REM later). Without both, src/lib/supabase.ts exports null and NO screen
REM in the EXE ever receives a realtime event — the reported "nothing is
REM updating". Vite reads process env first, then .env.local. Fail loudly
REM here instead of shipping a silent no-realtime installer.
if not defined VITE_SUPABASE_URL (
  findstr /c:"VITE_SUPABASE_URL" .env.local >nul 2>&1
  if errorlevel 1 (
    echo ERROR: VITE_SUPABASE_URL is missing. The EXE would ship with
    echo realtime permanently disabled and no screen would ever live-update.
    echo Fix: cd to this folder and run  npx vercel env pull .env.local
    echo ^(then re-run this build^), or set VITE_SUPABASE_URL in the
    echo environment before building.
    pause
    exit /b 1
  )
  echo Supabase URL source: .env.local
) else (
  echo Supabase URL source: environment
)
if not defined VITE_SUPABASE_ANON_KEY (
  findstr /c:"VITE_SUPABASE_ANON_KEY" .env.local >nul 2>&1
  if errorlevel 1 (
    echo ERROR: VITE_SUPABASE_ANON_KEY is missing. Same as above: no key,
    echo no realtime channel in the EXE.
    echo Fix: npx vercel env pull .env.local  ^(or set the variable^),
    echo then re-run this build.
    pause
    exit /b 1
  )
  echo Supabase anon-key source: .env.local
) else (
  echo Supabase anon-key source: environment
)
if not exist "node_modules" (
  echo Installing dependencies - one time, a few minutes...
  call npm ci
  if errorlevel 1 (
    echo NPM INSTALL FAILED. Check disk space and internet, then retry.
    pause
    exit /b 1
  )
) else (
  echo node_modules present - skipping install.
)
echo Generating icons...
call node scripts/make-icons.mjs
if errorlevel 1 (
  echo ICON STEP FAILED.
  pause
  exit /b 1
)
echo Building web bundle for Electron...
set VB_NATIVE_ELECTRON=1
call npm run build
if errorlevel 1 (
  echo WEB BUILD FAILED. Scroll up for the first error line.
  pause
  exit /b 1
)
echo Building Windows installer (electron-builder, a few minutes)...
REM Drop the previous half-built output: a stale win-unpacked from a failed
REM run poisons the retry (missing resources dir).
if exist "electron\dist" rmdir /s /q "electron\dist"
call npx electron-builder --config electron-builder.yml --win --publish never
if errorlevel 1 (
  echo INSTALLER BUILD FAILED. Scroll up for the first error line.
  pause
  exit /b 1
)
echo.
echo BUILD OK. Your installer is in: %CD%\electron\dist\
dir /b electron\dist\*.exe
echo Uninstall the old Voice Flow first, then run the new installer.
pause
