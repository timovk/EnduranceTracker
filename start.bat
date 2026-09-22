@echo off
REM ---------------------------------------------------------------------
REM  Endurance Racing Career Mode
REM
REM  Double-click this file. It sets everything up the first time, and
REM  just starts the application every time after that.
REM ---------------------------------------------------------------------
setlocal
cd /d "%~dp0"
title Endurance Racing Career Mode

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or this window was opened before it was.
  echo.
  echo   Install the LTS version from https://nodejs.org
  echo   then close this window and double-click this file again.
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

echo   Preparing your career database...
call npx prisma migrate deploy
if errorlevel 1 goto failed

if not exist "endurance.db" goto seed
goto run

:seed
echo   Setting up a new career...
call npm run db:seed

:run
echo.
echo   ===============================================================
echo     Endurance Racing Career Mode is starting.
echo.
echo     It will open in your browser in a moment. If it does not,
echo     go to:  http://localhost:3000
echo.
echo     Leave this window open while you use it.
echo     Press Ctrl+C here to stop.
echo   ===============================================================
echo.
REM Open the browser a few seconds from now, once the server is listening.
start /min "" cmd /c "timeout /t 6 /nobreak >nul & start "" http://localhost:3000"
call npm run dev
goto end

:failed
echo.
echo   Something went wrong above. Copy the error and ask for help.
echo.
pause

:end
endlocal
