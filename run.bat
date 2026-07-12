@echo off
title G-AnnStudio
REM run from this script's own folder so pnpm finds the workspace even on double-click
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo Error: pnpm not found in PATH.
    echo Install pnpm first: https://pnpm.io/installation
    pause
    exit /b 1
)

REM make the Rust backend find ffmpeg + G-Maiden deterministically (not via PATH).
REM resolve_bin / resolve_gmaiden_dir check p.exists(), so a stale value is
REM ignored; only set when the caller hasn't already provided one.
if not defined FFMPEG_PATH set "FFMPEG_PATH=D:\fluxnode-dev\src-tauri\target\release\ffmpeg.exe"
if not defined GMAIDEN_DIR set "GMAIDEN_DIR=G:\G-Maiden"

echo Starting G-AnnStudio (tauri dev)...
call pnpm ann-studio:dev
if errorlevel 1 (
    echo.
    echo Dev server stopped with errors.
    pause
)
