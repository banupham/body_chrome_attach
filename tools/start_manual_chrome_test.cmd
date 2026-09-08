@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "EXT=%ROOT%\dist"
set "PROFILE=%ROOT%\artifacts\manual-chrome-profile"

if not exist "%EXT%\manifest.json" (
  echo [ERROR] Missing %EXT%\manifest.json
  echo Run: npm run extension:package
  exit /b 2
)

set "CHROME=%BODY_CHROME_EXE%"
if defined CHROME if not exist "%CHROME%" set "CHROME="

if not defined CHROME (
  for /f "delims=" %%F in ('where /r "%USERPROFILE%\.cache\puppeteer" chrome.exe 2^>nul') do (
    if not defined CHROME set "CHROME=%%F"
  )
)

if not defined CHROME (
  echo [ERROR] Chrome for Testing was not found.
  echo Run: npm install
  echo Or set BODY_CHROME_EXE to the full path of Chrome for Testing chrome.exe.
  exit /b 3
)

if not exist "%PROFILE%" mkdir "%PROFILE%"

echo Chrome for Testing: %CHROME%
echo BODY Extension:     %EXT%
echo Manual profile:     %PROFILE%
echo.
echo Starting Chrome with BODY Extension loaded at browser startup...
start "" "%CHROME%" "--user-data-dir=%PROFILE%" "--disable-extensions-except=%EXT%" "--load-extension=%EXT%" --no-first-run --no-default-browser-check "chrome://extensions/" "https://example.com/"

echo.
echo No browser automation is running.
echo Keep this Chrome window open and perform the BODY checks manually.
echo See MANUAL_RELEASE_TEST.md for the exact checklist.
exit /b 0
