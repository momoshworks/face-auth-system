# PowerShell Runner for AI FaceID Desktop Workstation Pro
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "   محطة التعرف على الوجه الذكية والحضور البيومتري للكمبيوتر" -ForegroundColor Yellow
Write-Host "   AI FaceID Desktop Workstation Pro (Biometrics & Attendance)" -ForegroundColor White
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "🌐 رابط النظام المباشر: http://localhost:8000" -ForegroundColor Green
Write-Host ""
Write-Host "جاري تشغيل المتصفح التلقائي..." -ForegroundColor Gray
Start-Process "http://localhost:8000"
Write-Host ""
Write-Host "اضغط Ctrl+C لإيقاف الخادم" -ForegroundColor Gray
Write-Host ""

Set-Location $PSScriptRoot
python -m uvicorn main:app --host 127.0.0.1 --port 8000
