@echo off
rem UDF Editor - bilgisayar e-imza koprusu. Cift tiklayin; saatin yaninda simge olarak durur.
rem Gerekli: uv (https://docs.astral.sh/uv/) ve e-imza kartinizin surucusu.
cd /d "%~dp0"
where uv >nul 2>nul || (echo uv bulunamadi. Kurulum: powershell -c "irm https://astral.sh/uv/install.ps1 ^| iex" ^& pause ^& exit /b 1)
start "" uv run --gui-script kopru.py
