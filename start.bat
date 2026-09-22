@echo off
REM ---------------------------------------------------------------------
REM  Endurance Racing Career Mode - run it from the source
REM
REM  This is NOT how to use the application. The application is a Windows
REM  program you install from the Releases page; see README.md.
REM
REM  This file is for working ON it without opening a terminal: it sets the
REM  project up the first time, then starts the development server and opens
REM  it in your browser.
REM ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title Endurance Racing Career Mode - development server

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or this window was opened before it was.
  echo.
  echo   Install the LTS version from https://nodejs.org
  echo   then close this window and double-click this file again.
  echo.
  echo   If you only want to USE the application, you do not need Node at
  echo   all - download the installer from the Releases page instead.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo   First run: creating your settings file...
  copy /y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo.
  echo   First run: installing. This takes a few minutes, once.
  echo.
  call npm install
  if errorlevel 1 goto failed
)

echo   Preparing the database...
REM `npm run`, never `npx`: npx falls back to the registry's `latest` when it
REM cannot resolve the local copy, and that is currently a release candidate
REM for the next major version with a different command set.
call npm run db:deploy
if errorlevel 1 goto failed

REM No seeding. The application asks you to create an account on first run,
REM exactly as the installed version does, and seeding one here would replace
REM that with somebody else's name. `npm run db:seed:demo` fills an existing
REM account with a demonstration career if you want one.

echo.
echo   ===============================================================
echo     Starting the development server.
echo.
echo     It will open in your browser in a moment. If it does not,
echo     go to:  http://localhost:3000
echo.
echo     The first screen asks you to create an account.
echo.
echo     Leave this window open while you use it.
echo     Press Ctrl+C here to stop.
echo   ===============================================================
echo.
REM Open the browser a few seconds from now, once the server is listening.
start "" /min cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:3000"
call npm run dev
goto end

:failed
echo.
echo   Something went wrong above. Copy the error and ask for help.
echo.
pause

:end
endlocal
