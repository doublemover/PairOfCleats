@echo off
setlocal
if /I "%1"=="--version" exit /b 2
if /I "%1"=="version" exit /b 2
if /I "%1"=="--help" exit /b 2
if /I "%1"=="help" exit /b 2
if /I "%1"=="-h" exit /b 2
node "%~dp0\..\stub-lsp-server.js" %*
