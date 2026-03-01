@echo off
setlocal
if "%1"=="--version" goto :hang
if "%1"=="-version" goto :hang
if "%1"=="version" goto :hang
if "%1"=="--help" goto :hang
if "%1"=="-help" goto :hang
if "%1"=="help" goto :hang
if "%1"=="-h" goto :hang
echo hang-probe ok
exit /b 0

:hang
node -e "setInterval(() => {}, 60000)"
