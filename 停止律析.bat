@echo off
title Lvxi - Stop Service

echo.
echo  Stopping Lvxi service...
echo.

taskkill /F /IM node.exe >nul 2>nul

if errorlevel 1 (
    echo  No running service detected.
) else (
    echo  Service stopped.
)

echo.
echo  Press any key to close...
pause >nul
