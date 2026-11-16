@echo off
title Lvxi - AI Legal Data Analysis Platform
cd /d "%~dp0"

echo.
echo  ============================================
echo   Lvxi (Lu Xi) - AI Legal Data Platform
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo  Please install Node.js first: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  [1/3] First run: installing dependencies (1-2 min)...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed. Check your network.
        echo.
        pause
        exit /b 1
    )
    echo.
) else (
    echo  [1/3] Dependencies already installed.
)

if not exist ".env.local" (
    echo  [2/3] .env.local not found, creating from template...
    copy .env.example .env.local >nul
    echo.
    echo  [IMPORTANT] Please configure your API Key first:
    echo    1. Open .env.local with Notepad
    echo    2. Replace DEEPSEEK_API_KEY=sk-xxx with your real key
    echo    3. Save, then run this script again
    echo.
    pause
    exit /b 1
)

findstr /C:"sk-把你的key粘贴到这里" .env.local >nul 2>nul
if not errorlevel 1 (
    echo  [2/3] API Key is still a placeholder. Please fill in your real key.
    echo  Open .env.local and replace DEEPSEEK_API_KEY value.
    echo.
    pause
    exit /b 1
)

echo  [2/3] API Key configured.

echo  [3/3] Starting server...
echo.

start "Lvxi Server" cmd /c "npm run dev"

echo  Waiting for server (about 5 seconds)...
timeout /t 5 /nobreak >nul

start "" http://localhost:3000

echo.
echo  ============================================
echo   Started! Browser should open automatically.
echo   If not, visit: http://localhost:3000
echo  ============================================
echo.
echo  Tips:
echo   - Close the "Lvxi Server" black window to stop the service
echo   - This window can be closed anytime
echo.
pause
