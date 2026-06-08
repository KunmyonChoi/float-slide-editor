# 배포 가이드

구조: **프론트엔드 = Netlify(정적)**, **PPT 변환 서버 = 로컬 Docker 컨테이너**.
프론트는 사용자 PC의 컨테이너(`http://localhost:8321`)를 직접 호출한다(프록시 불필요).
컨테이너가 없으면 자동으로 pptxgenjs 폴백(폰트 임베딩 없음).

## 1. 프론트엔드 (Netlify)

```bash
npm i -g netlify-cli      # 1회
netlify login             # 대화형 로그인 (브라우저)
npm run build             # dist/ 생성
netlify deploy --prod --dir=dist
# 또는 netlify init 으로 사이트 연결 후 git 푸시 자동 배포
```

`netlify.toml`에 빌드/배포·SPA 리다이렉트가 정의돼 있다.
다른(클라우드) 백엔드를 쓰려면 빌드 환경변수 `VITE_PPTX_BACKEND_URL`을 지정한다.

## 2. PPT 변환 서버 (Docker Hub: `dilly97/float-pptx`)

```bash
# 빌드 & 푸시 (이미지명은 본인 Docker Hub 계정에 맞게)
docker build -t dilly97/float-pptx pptx-server
docker login
docker push dilly97/float-pptx

# 실행 (사용자 PC)
docker run -p 8321:8321 dilly97/float-pptx
```

실행 후 사이트의 PPT 버튼 ▾ 메뉴에서 상태가 "연결됨"으로 바뀐다(↻로 재확인).
PPT 버튼 ▾ 메뉴에 `docker run` 명령과 백엔드 URL 입력이 표시된다.

## 3. 백엔드 URL 설정

- 기본값: dev=상대경로(vite proxy), prod=`http://localhost:8321`
- 빌드 시: `VITE_PPTX_BACKEND_URL=https://...`
- 런타임: PPT ▾ 메뉴의 "백엔드 URL" 입력, 또는 콘솔
  `localStorage.setItem('pptx-backend-url', 'http://localhost:8321')`

## 4. 폰트

- **PPT 임베딩**: 서버가 런타임에 웹폰트를 내려받아 임베드 → 시스템 폰트 설치 불필요(인터넷 필요).
- **cairosvg(SVG 내부 텍스트)**: 시스템 설치 폰트 사용. 기본 이미지에 `fonts-noto-core`, `fonts-nanum` 포함.
  - 추가: `pptx-server/fonts/`에 `.ttf/.otf`를 넣고 재빌드, 또는
  - 런타임 마운트: `docker run -v /my/fonts:/usr/share/fonts/custom:ro -p 8321:8321 dilly97/float-pptx`

## 5. CORS / 브라우저

- 서버는 CORS 허용(기본 `*`, `ALLOWED_ORIGINS`로 제한 가능) + Chrome Private Network Access 헤더 응답.
- HTTPS 사이트 → `http://localhost` 호출은 브라우저가 localhost를 신뢰 컨텍스트로 예외 허용.
- 같은 PC에서 사이트를 열어야 로컬 컨테이너를 사용(다른 기기는 폴백).
