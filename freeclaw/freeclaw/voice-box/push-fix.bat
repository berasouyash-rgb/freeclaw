@echo off
REM Push the desktop fetch fix to GitHub (double-click, no commands to type).
REM Commits everything on the current branch and pushes to origin.
cd /d "%~dp0..\..\"
echo Current folder: %CD%
where git >nul 2>nul
if errorlevel 1 (
  echo ERROR: git is not installed or not on PATH. Install Git for Windows first.
  pause
  exit /b 1
)
echo --- branch ---
git branch --show-current
echo --- status (short) ---
git status --short --branch
git add -A
git commit -m "Fix desktop Failed to fetch: native API fallback, CORS, credentials, SameSite" 2>nul
if errorlevel 1 echo (nothing new to commit - continuing to push existing commits)
echo --- pushing ---
git push
if errorlevel 1 (
  echo PUSH FAILED - likely needs login. Run: git push
  echo and sign in when asked, then double-click this file again.
  pause
  exit /b 1
)
echo PUSH OK. Next: redeploy Vercel, then run the Native workflow for the EXE.
pause
