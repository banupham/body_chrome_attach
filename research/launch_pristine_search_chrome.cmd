@echo off
setlocal
set "ROOT=%~dp0.."
set "DIST=%ROOT%\dist"
set "PROFILE=%ROOT%\research\profiles\pristine-search"

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

echo [PRISTINE] Close every other BODY-managed Chrome before continuing.
echo [PRISTINE] Resetting dedicated lab profile only:
echo            %PROFILE%
if exist "%PROFILE%" rmdir /s /q "%PROFILE%"
mkdir "%PROFILE%" >nul 2>nul

echo [PRISTINE] Launching signed-out Chrome with a new user-data-dir and only the BODY unpacked extension.
start "BODY Pristine Search Lab" "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-sync --disable-extensions-except="%DIST%" --load-extension="%DIST%" "https://www.youtube.com/"

echo [PRISTINE] Wait until BODY shows this Browser as ACTIVE/eligible, then run research:search.
exit /b 0
