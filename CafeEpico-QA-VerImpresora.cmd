@echo off
setlocal
cd /d "%~dp0"
echo === CAFE EPICO: DIAGNOSTICO PUENTE DE IMPRESION LOCAL QA ===
echo NO imprime papel, no envia comandas, no toca el POS comercial.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\check-qa-printer.ps1"
echo.
pause
