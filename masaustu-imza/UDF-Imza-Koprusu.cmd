@echo off
rem UDF Editor - bilgisayar e-imza koprusu. Cift tiklayin; saatin yaninda simge olarak durur.
rem Komut penceresi acilmaz: uvw (pencere acmayan uv) kullanilir.
cd /d "%~dp0"
where uvw >nul 2>nul && (start "" uvw run --gui-script kopru.py & exit /b 0)
where uv >nul 2>nul || (echo uv bulunamadi. Kurulum: powershell -c "irm https://astral.sh/uv/install.ps1 ^| iex" ^& pause ^& exit /b 1)
start "" /min uv run --gui-script kopru.py
