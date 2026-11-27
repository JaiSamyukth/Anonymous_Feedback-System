@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Anonymous Faculty Feedback System
cd /d "%~dp0"

rem ======================================================================
rem  Anonymous Faculty Feedback System - one-click start for Windows
rem  1. Uses Node.js 22.13+ if installed, otherwise downloads a private
rem     copy into the .runtime folder (no admin rights needed)
rem  2. Installs the app's packages (first run, or after an update)
rem  3. Imports the old system's CSV files if you put them in legacy-data\
rem  4. Starts the server and opens the browser
rem ======================================================================

set "NODE_VERSION=v22.21.1"
if "%PORT%"=="" set "PORT=3000"
rem To start with an empty institution instead of the demo data, remove "rem" on the next line:
rem set "SEED_DEMO=0"
set "RUNTIME=%~dp0.runtime"

echo.
echo  ==========================================================
echo     Anonymous Faculty Feedback System
echo  ==========================================================
echo.

rem ---------- 1. Node.js ----------------------------------------------
set "NODE_OK=0"
where node >nul 2>nul
if not errorlevel 1 (
  node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>nul
  if not errorlevel 1 set "NODE_OK=1"
)

if "!NODE_OK!"=="0" (
  set "ARCH=x64"
  if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
  set "NODE_DIR=%RUNTIME%\node-%NODE_VERSION%-win-!ARCH!"
  if not exist "!NODE_DIR!\node.exe" (
    echo  [1/4] Node.js 22.13 or newer was not found.
    echo        Downloading a private copy ^(about 30 MB, one time only^)...
    if not exist "%RUNTIME%" mkdir "%RUNTIME%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
      "$zip=Join-Path $env:RUNTIME 'node.zip';" ^
      "Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/' + $env:NODE_VERSION + '/node-' + $env:NODE_VERSION + '-win-' + $env:ARCH + '.zip') -OutFile $zip;" ^
      "Expand-Archive -Path $zip -DestinationPath $env:RUNTIME -Force; Remove-Item $zip"
    if errorlevel 1 (
      echo.
      echo  ERROR: Could not download Node.js. Check the internet connection,
      echo         or install Node.js 22 LTS from https://nodejs.org and run this again.
      goto :fail
    )
  )
  set "PATH=!NODE_DIR!;%PATH%"
  echo  [1/4] Using bundled Node.js %NODE_VERSION%
) else (
  for /f "delims=" %%v in ('node -v') do echo  [1/4] Using installed Node.js %%v
)

rem ---------- 2. Packages ---------------------------------------------
set "NEED_INSTALL=0"
if not exist "node_modules\express\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\.installed-stamp" set "NEED_INSTALL=1"
if exist "node_modules\.installed-stamp" (
  rem reinstall when package-lock.json is newer than the last install
  powershell -NoProfile -Command "if ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules\.installed-stamp').LastWriteTime) { exit 1 } else { exit 0 }"
  if errorlevel 1 set "NEED_INSTALL=1"
)
if "!NEED_INSTALL!"=="1" (
  echo  [2/4] Installing packages ^(first run only, needs internet^)...
  call npm ci --omit=dev --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo        npm ci failed, trying npm install...
    call npm install --omit=dev --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
      echo.
      echo  ERROR: Could not install packages. Check the internet connection and try again.
      goto :fail
    )
  )
  echo installed> "node_modules\.installed-stamp"
) else (
  echo  [2/4] Packages already installed
)

rem ---------- 3. Old system data (optional) ----------------------------
if not exist "data" mkdir "data"
if exist "legacy-data\*.csv" (
  if not exist "data\.legacy-imported" (
    echo  [3/4] Importing the old system's CSV files from legacy-data\ ...
    call npm run import-legacy --silent -- "legacy-data"
    if errorlevel 1 (
      echo        WARNING: the legacy import failed - see the messages above.
    ) else (
      echo imported> "data\.legacy-imported"
    )
  ) else (
    echo  [3/4] Old system data already imported
  )
) else (
  echo  [3/4] No old system data to import ^(optional: put the old CSV files in legacy-data\^)
)

rem ---------- 4. Start ---------------------------------------------------
echo  [4/4] Starting the server on port %PORT% ...
echo.
echo        Student portal : http://localhost:%PORT%/
echo        Faculty portal : http://localhost:%PORT%/faculty
echo        Admin portal   : http://localhost:%PORT%/admin   ^(admin / admin123^)
echo.
echo        Other computers on the same network can use the "Network" address
echo        printed below. If Windows Firewall asks, click "Allow access".
echo        Keep this window open. Close it (or press Ctrl+C) to stop the system.
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%PORT%/'"
node --disable-warning=ExperimentalWarning server\index.js
echo.
echo  The server has stopped.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
