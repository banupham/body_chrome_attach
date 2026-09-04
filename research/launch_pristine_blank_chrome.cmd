@echo off
setlocal
set "ROOT=%~dp0.."
set "DIST=%ROOT%\dist"
set "PROFILE=%ROOT%\research\profiles\pristine-blank-search"

if not exist "%DIST%\manifest.json" (
  echo [ERROR] Missing %DIST%\manifest.json
  echo Run: npm install ^&^& npm run build
  exit /b 1
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [ERROR] Google Chrome was not found.
  exit /b 1
)

echo [COLD START] Close every other BODY-managed Chrome before continuing.
echo [COLD START] Resetting dedicated blank profile only:
echo              %PROFILE%
if exist "%PROFILE%" rmdir /s /q "%PROFILE%"
mkdir "%PROFILE%" >nul 2>nul

echo [COLD START] Launching signed-out Chrome at about:blank with no HTTPS start URL.
start "BODY Pristine Blank Lab" "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-sync --disable-extensions-except="%DIST%" --load-extension="%DIST%" "about:blank"

echo [COLD START] Next step: npm run research:blank-bootstrap
echo [COLD START] Or use research\run_pristine_blank_search.cmd with the research arguments.
exit /b 0
