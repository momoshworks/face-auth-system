@echo off
title AI FaceID Desktop Workstation Pro
chcp 65001 >nul
cd /d "%~dp0"
echo =======================================================================
echo    محطة التعرف على الوجه الذكية والحضور البيومتري (Desktop Workstation)
echo    AI Face Recognition, Anti-Spoofing & Biometric Attendance System
echo =======================================================================
echo.
echo  [+] جاري تشغيل خادم المحطة الذكية على الكمبيوتر...
echo  🌐 رابط النظام المباشر: http://localhost:8000
echo.
echo  [+] جاري فتح المتصفح تلقائياً...
start http://localhost:8000
echo.
echo  اضغط Ctrl+C لإيقاف النظام
echo =======================================================================
python -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
