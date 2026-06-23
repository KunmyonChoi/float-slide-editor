@echo off
chcp 65001 >nul
setlocal
rem Genitor 피사체 분리 서버 — Windows(NVIDIA GPU) 네이티브 실행기(더블클릭).
rem 첫 실행 시 uv로 Python·의존성 자동 설치(선설치 불필요), CUDA torch로 GPU 가속.
rem NVIDIA 그래픽 드라이버는 미리 설치돼 있어야 함(GPU 없으면 자동 CPU 폴백).
set "DIR=%~dp0"
set "APPSUP=%LOCALAPPDATA%\genitor-cutout"
set "VENV=%APPSUP%\.venv"
set "PATH=%USERPROFILE%\.local\bin;%PATH%"
if not exist "%APPSUP%" mkdir "%APPSUP%"

echo -- Genitor 피사체 분리 서버 (Windows / NVIDIA GPU) --

where uv >nul 2>nul || (
  echo uv 설치 중...
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
)

if not exist "%VENV%" uv venv --python 3.12 "%VENV%"
call "%VENV%\Scripts\activate.bat"

echo 의존성 확인/설치 중... (최초 실행은 수 분 — CUDA torch 다운로드)
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
uv pip install -r "%DIR%requirements.txt"

cd /d "%DIR%"
echo 서버 시작 -^> http://localhost:8322   (중지: Ctrl+C)
uvicorn server:app --host 0.0.0.0 --port 8322
