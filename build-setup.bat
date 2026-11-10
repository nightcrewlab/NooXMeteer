@echo off
chcp 65001 >nul
title NooXMeteer - Setup Olusturucu
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun.
  pause & exit /b 1
)
echo [1/2] Bagimliliklar yukleniyor...
call npm install
if errorlevel 1 (echo [HATA] npm install basarisiz & pause & exit /b 1)
echo [2/2] Setup dosyasi olusturuluyor...
call npm run dist
if errorlevel 1 (echo [HATA] Derleme basarisiz & pause & exit /b 1)
echo.
echo Tamamlandi! Setup dosyasi "dist" klasorunde.
start "" "%~dp0dist"
pause
