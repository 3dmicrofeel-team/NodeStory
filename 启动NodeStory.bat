@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Please install Node.js or add node.exe to PATH.
  pause
  exit /b 1
)

start "" "http://localhost:4173"
npm start

pause
