# float-editor PPT 변환 서버 (FastAPI + python-pptx + cairosvg)
# 빌드: docker build -t dilly97/float-pptx pptx-server
# 실행: docker run -p 8321:8321 dilly97/float-pptx
#
# 폰트 참고:
# - PPT '임베딩'은 서버가 런타임에 웹폰트를 내려받아 처리하므로 시스템 폰트 설치 불필요(인터넷 필요).
# - 'cairosvg'가 SVG 내부 텍스트를 그릴 때만 시스템 설치 폰트를 사용한다.
#   추가 폰트는 (1) pptx-server/fonts/ 에 .ttf/.otf 를 넣고 재빌드, 또는
#   (2) 런타임에 볼륨 마운트: docker run -v /my/fonts:/usr/share/fonts/custom:ro ...
FROM python:3.12-slim

# cairosvg 시스템 의존 + fontconfig + 기본 라틴/한글 폰트(SVG 텍스트 렌더용)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi8 \
    fontconfig \
    fonts-noto-core \
    fonts-nanum \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 사용자 추가 폰트: pptx-server/fonts/ 안의 .ttf/.otf 가 설치된다(없으면 빈 폴더).
COPY fonts/ /usr/share/fonts/custom/

COPY . .

EXPOSE 8321
# 시작 시 fc-cache로 폰트 캐시 갱신(빌드 COPY + 런타임 볼륨 마운트 모두 반영) 후 서버 실행
CMD ["sh", "-c", "fc-cache -f >/dev/null 2>&1; exec uvicorn server:app --host 0.0.0.0 --port 8321"]
