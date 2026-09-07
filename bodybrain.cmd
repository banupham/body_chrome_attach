@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 desktop\main.py %*
  exit /b %errorlevel%
)
where python >nul 2>nul
if %errorlevel%==0 (
  python desktop\main.py %*
  exit /b %errorlevel%
)
echo [ERROR] Python 3 was not found on PATH.
exit /b 1
