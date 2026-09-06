@echo off
node "%~dp0body_cli.js" %*
exit /b %ERRORLEVEL%
