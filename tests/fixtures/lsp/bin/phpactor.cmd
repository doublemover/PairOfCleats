@echo off
setlocal
if "%1"=="--version" exit /b 0
if "%1"=="--help" exit /b 0
if "%1"=="-h" exit /b 0
if /i not "%1"=="language-server" exit /b 1
node "%~dp0\..\stub-lsp-server.js" --mode php
