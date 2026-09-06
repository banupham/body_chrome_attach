@echo off
setlocal
set "ROOT=%~dp0.."

cd /d "%ROOT%"
echo [COLD START ATTACH] This command does not launch Chrome and does not assume any chrome.exe path.
echo [COLD START ATTACH] Open the Chrome/Chromium build you want to test yourself with BODY loaded.
echo [COLD START ATTACH] Leave the newest BODY-managed Browser on about:blank or a blank/new-tab page.
echo [COLD START ATTACH] BODY will discover that Browser dynamically, navigate to YouTube through Browser UI, then start research.
call npm run research:search:cold -- %*
exit /b %errorlevel%
