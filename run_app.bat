@echo off
title Face Recognition, Local Team Chat & Mobile Live Camera System
chcp 65001 >nul
cd /d "%~dp0"
echo =======================================================================
echo    نظام التعرف على الوجه، الشات المباشر، سحابة الملفات ودعم الموبايل
echo    Face Recognition, Local Team Chat, File Vault & Mobile Live Camera
echo =======================================================================
echo.
echo  [✓] جاري تشغيل خادم النظام المزدوج (HTTP للكمبيوتر + HTTPS للموبايل)...
echo.
echo  🌐 رابط الكمبيوتر المباشر:            http://localhost:8000
echo  📱 رابط الموبايل (لتشغيل الكاميرا لايف):  https://192.168.1.2:8443
echo  🏠 رابط الشبكة العادي (LAN IP):         http://192.168.1.2:8000
echo.
echo  اضغط Ctrl+C لإيقاف الخادم
echo =======================================================================
python server.py
pause
