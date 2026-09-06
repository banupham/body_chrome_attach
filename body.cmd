@echo off
setlocal
set "BODY_CLI=%~dp0body_cli.js"
if not exist "%BODY_CLI%" (
  echo [LOI] Khong tim thay "%BODY_CLI%" 1>&2
  endlocal & exit /b 2
)
node "%BODY_CLI%" %*
set "BODY_RC=%ERRORLEVEL%"
endlocal & exit /b %BODY_RC%
