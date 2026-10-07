@echo off
rem Понятные имена ЭСЗ на компьютере пользователя Windows: esz, zayavki, el-ap-sys.
rem Двойной щелчок по этому файлу — права администратора запрашиваются сами.
rem Свои имена:  setup-client-name.cmd -Names esz,pomosh
rem Убрать:      setup-client-name.cmd -Remove
chcp 65001 >nul
setlocal

net session >nul 2>&1
if errorlevel 1 (
  echo Нужны права администратора — сейчас появится запрос UAC...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-client-name.ps1" %*
echo.
pause
