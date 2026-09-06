@echo off
node -r "%~dp0daemon\src\sticky_runtime_port_preload.js" "%~dp0daemon\guardian_bootstrap.js"
