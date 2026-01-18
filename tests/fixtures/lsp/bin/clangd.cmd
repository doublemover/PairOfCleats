@echo off
setlocal
if "%1"=="--version" exit /b 0
if "%1"=="--help" exit /b 0
node "%~dp0\..\stub-lsp-server.js" --mode clangd
