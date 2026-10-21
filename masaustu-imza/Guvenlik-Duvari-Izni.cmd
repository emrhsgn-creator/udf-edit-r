@echo off
rem Uyap Asistan icindeki imza koprusune ayni yerel agdaki telefon/tabletlerin
rem baglanabilmesi icin Windows Guvenlik Duvari'na gelen baglanti izni ekler.
rem Yalnizca TCP 5976 ve 5977; yerel ag (LocalSubnet) ve Tailscale ozel agi
rem (100.64.0.0/10, yalnizca sizin Tailscale aygitlariniz). Internete acmaz.
rem Cift tiklayin; Windows yonetici izni sorar (Evet).

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$exe = Join-Path $env:LOCALAPPDATA 'Programs\uyap-asistan\resources\sidecar\uyap-asistan-sidecar.exe';" ^
  "Get-NetFirewallRule -DisplayName 'Uyap Asistan - imza koprusu' -ErrorAction SilentlyContinue | Remove-NetFirewallRule;" ^
  "New-NetFirewallRule -DisplayName 'Uyap Asistan - imza koprusu' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5976,5977 -RemoteAddress LocalSubnet,100.64.0.0/10 -Program $exe -Profile Any | Out-Null;" ^
  "Write-Host 'Izin eklendi: Uyap Asistan - imza koprusu (TCP 5976, 5977; yerel ag + Tailscale).'"
echo.
pause
