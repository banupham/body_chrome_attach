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

set "CHROME="
if defined BODY_CHROME_EXE set "CHROME=%BODY_CHROME_EXE%"
if defined CHROME if not exist "%CHROME%" (
  echo [ERROR] BODY_CHROME_EXE does not exist: %CHROME%
  exit /b 1
)
if not defined CHROME set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [ERROR] Google Chrome was not found in standard locations.
  echo [INFO] This launcher is optional. Open any BODY-enabled Chrome manually and run research\run_pristine_blank_search.cmd.
  echo [INFO] Or set BODY_CHROME_EXE to the exact executable path before calling this helper.
  exit /b 1
)

echo [COLD START] Close every other BODY-managed Chrome before continuing.
echo [COLD START] Executable: %CHROME%
echo [COLD START] Resetting dedicated blank profile only:
echo              %PROFILE%
if exist "%PROFILE%" rmdir /s /q "%PROFILE%"
mkdir "%PROFILE%" >nul 2>nul

echo [COLD START] Launching signed-out Chrome at about:blank with no HTTPS start URL.
start "BODY Pristine Blank Lab" "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-sync --disable-extensions-except="%DIST%" --load-extension="%DIST%" "about:blank"

echo [COLD START] Next step: npm run research:search:cold -- [research args]
echo [COLD START] For path-independent use, you may ignore this launcher and open Chrome manually.
exit /b 0
