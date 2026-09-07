@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 goto use_py

where python >nul 2>nul
if not errorlevel 1 goto use_python

echo [ERROR] Python 3 was not found on PATH.
exit /b 1

:use_py
py -3 desktop\main.py %*
exit /b %errorlevel%

:use_python
python desktop\main.py %*
exit /b %errorlevel%
