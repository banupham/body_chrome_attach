@echo off
setlocal
cd /d %~dp0
node tools\body_contract_live_smoke.js
endlocal
