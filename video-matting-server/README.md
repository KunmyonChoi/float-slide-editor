# video-matting-server (float-matte)

RVM(Robust Video Matting) 기반 **비디오 전경 매팅** 서버. 영상을 받아 사람 전경만 남긴
**알파 WebM(투명 영상)** 을 반환한다. 셀프 아바타 배경 제거 **B2**(고품질·베이크) — 브라우저
실시간 B1(MediaPipe)의 서버 버전. recurrent state로 프레임 간 시간적 일관성(깜빡임 억제).

`cutout-server`(이미지 BiRefNet)와 동일한 CORS/PNA/health/워밍업 패턴.

## 엔드포인트
- `GET  /api/health` — 상태·디바이스·모델·준비여부·빌드
- `POST /api/matte` — multipart `video` → **알파 WebM**(VP9/VP8 `yuva420p`) + `X-Inference-Ms` 헤더

## 실행
```bash
# Docker (NVIDIA GPU 가속: --gpus all; 없으면 자동 CPU)
docker run -d --gpus all --pull=always --name float-matte -p 8325:8325 dilly97/float-matte

# 로컬(개발) — GPU 미사용(예: 학습 중 서버) 강제:
CUDA_VISIBLE_DEVICES="" MATTE_DEVICE=cpu uvicorn server:app --port 8325
```

## 환경변수
- `MATTE_DEVICE`   기본 `cuda`. `cpu`면 GPU 미사용(학습 서버 보호). CUDA 불가 시 자동 CPU 폴백.
- `MATTE_MODEL`    기본 `mobilenetv3`(빠름). `resnet50`이면 품질↑·느림.
- `MATTE_DOWNSAMPLE` 기본 `0.25`(RVM HD 권장). SD 영상은 1.0 권장.
- `MATTE_BITRATE`  기본 `3M`. 알파 WebM 비트레이트.
- `ALLOWED_ORIGINS` 기본 `*`(로컬 전용 서버).

## 출력 포맷 주의 (알파 WebM)
- 결과는 **VP9(또는 VP8) `yuva420p` WebM**. `<video>`에서 **브라우저가 투명 재생**한다(Chrome/Firefox).
- **ffmpeg/ffprobe의 vpx 디코더는 알파를 되돌리지 못해** `yuv420p`/불투명으로 보이지만, 이는
  오판이다 — 알파는 Matroska BlockAdditional에 저장되어 브라우저에서 정상 디코드된다.
- **Safari**는 VP alpha 미지원 → 클라이언트가 실시간 B1(MediaPipe) 합성으로 폴백.

## 라이선스 주의
RVM 가중치는 연구·개인용 라이선스다. 상용 배포 시 라이선스 확인 필요(대안: BiRefNet 프레임별).
