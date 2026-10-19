@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === CAFE EPICO OPS LOCAL - ENTORNO DE PRUEBAS ===
echo SOLO inicia si Docker, secretos y PostgreSQL QA ya estan configurados.
echo NO copies claves de produccion. NO cierra la caja comercial.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\launch-qa.ps1" -Mode Start
echo.
echo Revisa las ventanas abiertas de Caddy y Next.js QA.
pause
