@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 18 or newer from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
start "MovieScore Private Server" /D "%~dp0" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8765
