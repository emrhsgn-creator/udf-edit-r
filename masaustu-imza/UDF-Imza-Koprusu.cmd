@echo off
rem UDF Editör — bilgisayar e-imza köprüsü. Çift tıklayın; pencereyi açık tutun.
rem Gerekli: uv (https://docs.astral.sh/uv/) ve e-imza kartınızın sürücüsü.
cd /d "%~dp0"
where uv >nul 2>nul || (echo uv bulunamadi. Kurulum: powershell -c "irm https://astral.sh/uv/install.ps1 ^| iex" & pause & exit /b 1)
uv run --script kopru.py
if errorlevel 1 pause
