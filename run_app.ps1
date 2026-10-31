# PowerShell Runner for Dual HTTP/HTTPS Face Recognition System
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "   نظام التعرف على الوجه، الشات المباشر، سحابة الملفات ودعم الموبايل" -ForegroundColor Yellow
Write-Host "   Face Recognition, Local Team Chat, File Vault & Mobile Live Camera" -ForegroundColor White
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 رابط الكمبيوتر المباشر:            http://localhost:8000" -ForegroundColor Green
Write-Host "📱 رابط الموبايل (لتشغيل الكاميرا لايف):  https://192.168.1.2:8443" -ForegroundColor Yellow
Write-Host "🏠 رابط الشبكة العادي (LAN IP):         http://192.168.1.2:8000" -ForegroundColor Gray
Write-Host ""
Write-Host "اضغط Ctrl+C لإيقاف الخادم" -ForegroundColor Gray
Write-Host ""

Set-Location $PSScriptRoot
python server.py
