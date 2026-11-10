@echo off
rem Chumps Lab Studio: starts the editor and opens it in your browser.
rem Double-click this file. Close the window (or press Ctrl+C) to stop the studio.
rem The local AI model (Bonsai, via llama-server) starts by itself the first time the AI needs it.
setlocal
cd /d "%~dp0"
title Chumps Lab Studio

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node 22 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo First run: installing dependencies, this takes a few minutes...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

rem Already running? Then just open it.
netstat -ano | findstr /R /C:":4173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo The studio is already running. Opening it.
  start "" http://localhost:4173
  exit /b 0
)

echo Building the editor...
pushd app
call npx vite build >nul 2>nul
if errorlevel 1 (
  echo The editor build failed. Run "npx vite build" inside the app folder to see why.
  popd
  pause
  exit /b 1
)
popd

if not exist ".env" echo [note] No .env file: the free cloud models are off, the local model is used. Put CLS_OPENROUTER_API_KEY=... in .env to enable them.

echo Starting the studio at http://localhost:4173 ...
start "" cmd /c "timeout /t 5 /nobreak >nul & start "" http://localhost:4173"
node node_modules\tsx\dist\cli.mjs app\server\main.ts

echo.
echo The studio stopped.
pause
