@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Please install Node.js or add node.exe to PATH.
  pause
  exit /b 1
)

start "" "http://localhost:4173"
npm start
set EXITCODE=%ERRORLEVEL%

echo.
echo ============================================================
echo NodeStory exited with code %EXITCODE%
echo If you see red [server] uncaughtException / unhandledRejection
echo / Error stack above, please copy it to the developer.
echo This window will stay open. Press any key to close.
echo ============================================================
pause
