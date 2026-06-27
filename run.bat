@echo off
title G-AnnStudio Dev Server
echo Checking for pnpm...
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: pnpm is not installed or not in PATH.
    echo Please install pnpm first: https://pnpm.io/installation
    pause
    exit /b 1
)

echo Starting G-AnnStudio dev server...
pnpm ann-studio:dev
if %errorlevel% neq 0 (
    echo.
    echo Dev server stopped with errors.
    pause
)
