@echo off
setlocal
set "ROOT=%~dp0.."

call "%~dp0launch_pristine_blank_chrome.cmd"
if errorlevel 1 exit /b %errorlevel%

cd /d "%ROOT%"
echo [COLD START] Waiting for the new BODY extension, then Browser UI will navigate from about:blank to YouTube.
call npm run research:search:cold -- %*
exit /b %errorlevel%
