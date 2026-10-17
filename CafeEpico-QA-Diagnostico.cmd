@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === CAFE EPICO OPS LOCAL - DIAGNOSTICO QA ===
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\launch-qa.ps1" -Mode Doctor
echo.
echo Este modo NO instala, NO abre puertos y NO registra cobros.
pause
