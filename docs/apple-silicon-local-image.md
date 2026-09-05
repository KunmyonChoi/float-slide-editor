# Qwen-Image-Edit-2511 · Apple Silicon 구동 가능성 판정

`docs/local-image-edit-server-spec.md`의 후속. 그 문서는 **CUDA 전제**로 쓰였고, §F-2의 권고 기본값 `IMGEN_QUANT=nf4`는 **macOS에서 성립하지 않는다**. 이 문서는 macOS 경로만 다룬다.

**작성 시점**: 2026-09-05 · **성격**: 리서치 산출물. 소스 코드는 수정하지 않았다.

---

## 판정

### **(가) 실용적으로 가능 — 단, PyTorch/diffusers가 아니라 MLX 경로로, 그리고 통합 메모리 64 GB 이상 Apple Silicon에서만.**
### **그 미만(≤ 36 GB)에서는 (다) 현재로선 불가.**

근거 한 문단: Apple MLX로 포팅된 Qwen-Image-Edit-2511이 **이미 존재하고**(`AbstractFramework/qwen-image-edit-2511-8bit`, Apache-2.0, 30.3 GB), 그것을 돌리는 런타임 `mlx-gen`(MIT, mflux 포크)이 **편집·마스크 인페인팅·아웃페인팅·T2I·Lightning LoRA·Python API를 전부 갖추고 있으며**, 업스트림이 공개한 M5 Max 실측치는 **768×432 / q8 / Lightning 4스텝 마스크 편집 = 12.4 초, 최대 RSS 31.8 GB**다. 이는 우리가 현재 감수하는 Ideogram TURBO 28 초보다 빠르다. 반대로 PyTorch/diffusers-MPS 경로는 세 겹으로 막힌다 — (1) **bitsandbytes NF4는 macOS에서 GPU 백엔드가 실질적으로 없다**(공식 설치 가이드가 macOS arm64 휠을 *CPU* 섹션에만 두고, Metal은 transformers 하드웨어 표에서 🟡), (2) **FP8은 MPS에서 연산 자체가 없어** bf16으로 되돌려 로드해야 하고 GGUF는 MPS에서 깨지거나(uint8 linear 미지원) 흐려지며, (3) 남는 유일한 dtype인 bf16은 **M1/M2/M3에서 하드웨어 가속이 없어**(네이티브 bf16은 M4부터) 4096² matmul 기준 fp16의 2.1배 느리다. 결국 Mac에서 이 모델을 돌리는 현실적인 방법은 MLX 하나뿐이고, 그 MLX 경로조차 편집 루트 피크 RSS가 **31 GB**라 업스트림 자신의 권고가 "Qwen edit이 여유로워지는 첫 티어는 64 GB"다. 그리고 **1024² 실측은 어디에도 공개돼 있지 않다** — 공개된 Qwen 편집 벤치는 전부 432×240 / 768×432이다.

---

## 0. 구성별 비교표

| # | 경로 | 되는가 | 메모리 | 속도 | 근거 |
|---|---|---|---|---|---|
| 1 | **MLX (`mlx-gen`) + `qwen-image-edit-2511-8bit` + Lightning 4스텝** | ✅ **된다. 마스크 편집·아웃페인팅·다중참조 전부 검증됨** | **31.8 GB 최대 RSS** (768×432) | **12.4 s** 마스크 편집 / **27.9 s** 전체 편집 (M5 Max) | mlx-gen 공개 실측 JSON |
| 2 | MLX + 같은 패키지, Lightning 없이 20스텝 g4 | ✅ | 30.9 GB | **124–156 s** (M5 Max, 768×432) | 〃 |
| 3 | MLX + `qwen-image-edit-2511-4bit` (mixed q4/q8) | ✅ 품질 PASS. **런타임 메모리 미공개** | 패키지 18.3 GB / 피크 미측정 | 미측정 | mlx-gen quantization.md |
| 4 | MLX + `qwen-image-2512-8bit` (T2I) | ✅ | **10.73 GiB 피크 RSS** (768×336, 4스텝) | 미공개 | mlx-gen recommendations.md |
| 5 | PyTorch/diffusers MPS + bf16 (57.7 GB 가중치) | △ 돈다. 96 GB+ 아니면 스왑 | 가중치만 41 GB(트랜스포머)~57.7 GB | **2:33** 최적 / 3:59 / 기본 ~10분 (M1 Max 64 GB, ComfyUI, 4스텝) | lilting.ch 실측 |
| 6 | PyTorch MPS + **bnb NF4** | ❌ **사실상 불가.** macOS 휠은 CPU 빌드로 문서화, Metal은 🟡 실험적 | — | — | bnb 설치 가이드 / transformers 표 / PR #1853 closed |
| 7 | PyTorch MPS + **FP8 e4m3fn** | ❌ **불가.** MPS에 fp8 연산 없음 → 로드 시 bf16 환원 = 메모리 이득 0 | — | — | lilting.ch |
| 8 | ComfyUI + **GGUF Q8_0** on MPS | △ 돌지만 **출력이 흐려짐** | — | 3:12 (M1 Max 64 GB) | 〃 |
| 9 | ComfyUI + **GGUF Q4_K_M** on 저사양 Mac | ❌ 비현실적 | 32 GB에서 스왑 | **13:29** (512²/20스텝), **51:33** (1024²/40스텝) — M4 32 GB | note.com 실측 |
| 10 | diffusers `GGUFQuantizationConfig` on MPS | ❌ 알려진 파손 | — | — | "MPS device does not support linear for non-float inputs" |
| 11 | Draw Things.app (Mac 네이티브) | ✅ 2511 지원. **우리 서버로 쓰려면 gRPC/HTTP 프록시 필요** | 앱 관리 | 미공개 | v1.20251223.0 릴리스 |

---

## 1. 확정 사실 (출처 URL 포함)

### A. MLX 포팅은 존재한다 — 그것도 우리가 필요한 4가지 작업 전부

| 항목 | 값 | 출처 |
|---|---|---|
| MLX 런타임 | **`mlx-gen`** (PyPI `mlx-gen` 0.33.1, 2026-09-02), **MIT**, `mflux`(Filip Strand) 포크 | https://github.com/lpalbou/mlx-gen · https://pypi.org/project/mlx-gen/ |
| 상류 런타임 | `mflux` (MIT). `mflux-generate-qwen` / `mflux-generate-qwen-edit`. **README가 `Qwen/Qwen-Image-Edit-2511`을 쓴다고 명시** | https://github.com/filipstrand/mflux/blob/main/src/mflux/models/qwen/README.md |
| 편집 패키지 (권장) | `AbstractFramework/qwen-image-edit-2511-8bit` — **Apache-2.0, gated: false, 30.34 GB**(HF blob 실측) | https://huggingface.co/AbstractFramework/qwen-image-edit-2511-8bit |
| 편집 패키지 (q4) | `AbstractFramework/qwen-image-edit-2511-4bit` — Apache-2.0, **18.29 GB**, mixed q4/q8 정책 | https://huggingface.co/AbstractFramework/qwen-image-edit-2511-4bit |
| 대안 패키지 | `mlx-community/qwen-image-edit-2511-8bit` — mflux 포맷, **37.47 GB**(HF blob 실측), Apache-2.0 | https://huggingface.co/mlx-community/qwen-image-edit-2511-8bit |
| T2I 패키지 | `AbstractFramework/qwen-image-2512-8bit` — Apache-2.0, **29.49 GB** | https://huggingface.co/AbstractFramework/qwen-image-2512-8bit |
| 필요 Python | ≥ 3.10. 설치는 `uv tool install --upgrade mlx-gen` | mlx-gen README |
| MLX 휠 최소 macOS | **macOS 14.0 arm64** (`macosx_14_0_arm64` 이하 태그 없음) | https://pypi.org/project/mlx/ |

**mlx-gen이 지원하는 루트 (전부 우리 프론트 4작업에 1:1 대응)**

| 우리 작업 (`src/core/imageJobRunner.js`) | mlx-gen 루트 | 검증 상태 (업스트림 공개) |
|---|---|---|
| ② 설명으로 편집 (마스크 있음) | `qwen.inpaint` — `--mask-path` | **Validated visual QA with Lightning LoRA** |
| ② 설명으로 편집 (마스크 없음) | `edit-reference` I2I | 2026-06-06 parity 프로파일 source/q8/q4 **PASS** |
| ③ 여백까지 그림 채우기 | `qwen.outpaint` — `--outpaint-padding "top,right,bottom,left"` + `--outpaint-fill` | 2026-06-08 reframe/outpaint 프로파일 **PASS**, `source region: original pixels restored` |
| ④ 인포그래픽 (전체 재해석) | `edit-reference` I2I | 〃 |
| ① 텍스트박스 → 이미지 (T2I) | `qwen-image-2512-8bit` 텍스트 루트 | 공개 패키지 (메모리 티어 표에 등재) |

> **중요 — 스펙 §G-2(ii)가 이미 구현돼 있다.** mlx-gen의 `qwen.inpaint`는 *"The edit checkpoints keep the full source image as conditioning while blending unmasked latents back each step."* 즉 **EditPlus의 올바른 2511 조건화를 유지한 채 latent 블렌딩만 이식한 형태**다. 스펙이 "이론적 최적해지만 커스텀 파이프라인 유지보수 부담"이라 적었던 그 방식이고, 이미 남이 유지보수하고 있다. 따라서 macOS 경로에서는 `QwenImageEditInpaintPipeline` 우회(스펙 §답1, 미검증 B-1)가 **필요 없다.**
>
> 마스크 극성도 동일하다: *"White mask pixels are repainted; black mask pixels are preserved."* → 스펙 §E-2의 알파 반전 로직이 그대로 재사용된다. 페더링도 동일하게 우리 책임이다(*"MLX-Gen binarizes masks at 50% luminance"*). 알파 채널이 있는 마스크는 **경고 후 무시**되고 luminance만 쓰인다.

### B. 실측 속도·메모리 (업스트림이 공개한 원본 JSON)

**Apple M5 Max, 40-core GPU, 128 GB 통합 메모리 · `AbstractFramework/qwen-image-edit-2511-8bit` · 768×432**
출처: https://github.com/lpalbou/mlx-gen/blob/main/docs/assets/validation/qwen-inpaint-2026-06-15/qwen2511_q8_inpaint_lightning_stats_m5max.json

| 케이스 | 스텝 | guidance | LoRA | 시간 | 최대 RSS |
|---|---|---|---|---|---|
| 마스크 편집 (엔진 부스트) | 20 | 4.0 | — | **155.53 s** | 30.91 GB |
| 마스크 편집 (엔진 부스트) | **4** | 1.0 | **Lightning 4steps bf16** | **12.38 s** | 31.76 GB |
| 마스크 없이 전체 편집 (대조군) | **4** | 1.0 | Lightning | **27.88 s** | 31.76 GB |
| 마스크 편집 (선체 수리) | 20 | 4.0 | — | **123.95 s** | 30.92 GB |
| 마스크 편집 (선체 수리) | **4** | 1.0 | Lightning | **12.43 s** | 31.75 GB |
| 마스크 없이 전체 편집 (대조군) | **4** | 1.0 | Lightning | **27.75 s** | 31.76 GB |

읽는 법:
- **Lightning 4스텝이 20스텝 대비 10–12배 빠르다.** 스펙 §A-8의 이론 forward 20배와 방향이 일치한다.
- **마스크가 있으면 더 빠르다**(12 s vs 28 s). 마스크 영역만 처리하기 때문.
- **q8이어도 RSS는 31 GB.** 패키지가 30.3 GB이므로 사실상 가중치 전체가 상주한다. 양자화로 메모리가 극적으로 줄지 않는다.
- LoRA 어댑터는 **`lightx2v/Qwen-Image-Edit-2511-Lightning:Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`** — 스펙 §A-7 표의 그 파일 그대로다. **스펙 §A-8의 스케줄러 교체는 mlx-gen이 내부에서 처리한다**(CLI에서 스케줄러를 만지지 않는다).

**아웃페인팅 (M5 Max, 20스텝 g4, Lightning 없음)**

| 프로파일 | 시간 | 출처 |
|---|---|---|
| 432×240 소스, 패딩 `5%,80%,5%,60%` | **341.1 s** | quantization.md / faq.md |
| starship 근접 크롭 소스 (다른 프로파일) | **198.5 s**, drift 9.35, `original pixels restored` | reframe-outpaint.md |

같은 표에서 FLUX.2 Klein 4B distilled q8이 8.4–54.6 s다. 업스트림 자신의 평가: *"Qwen's cost is speed: roughly 4-6x the FLUX.2 routes here."* **아웃페인팅에도 Lightning을 붙이면 10배 줄 것으로 기대되나 그 조합의 실측은 공개돼 있지 않다.**

**메모리 티어 — 업스트림 공식 권고**
출처: https://github.com/lpalbou/mlx-gen/blob/main/docs/recommendations.md

| 티어 | Qwen 편집 |
|---|---|
| 18 GB | *"Avoid Qwen edit and control routes here."* |
| 24 GB | 권고 없음 |
| 32 GB | *"For edit-heavy work, z-image-turbo-8bit and flux.2-klein-4b-8bit are still the safer defaults than Qwen Edit."* |
| **64 GB** | *"Add `AbstractFramework/qwen-image-edit-2511-8bit` for strong layout-preserving edit/reference work."* |
| | *"**64 GB is the first tier where Qwen edit and Qwen control routes become practical without running at the ceiling.**"* |

벤치 기준값: `qwen-image-edit-2511-8bit`, 768×432, 4스텝 → **30.91 GiB 피크 RSS**. 반면 `qwen-image-2512-8bit` T2I는 768×336 / 4스텝에서 **10.73 GiB**뿐이다(⚠️ 이 격차는 크고 이유가 문서화돼 있지 않다 — 편집 루트가 VL 인코더 + 조건 이미지를 상주시키기 때문으로 보이나 **추정**이다).

### C. PyTorch / diffusers MPS 경로가 막히는 지점

| 확정 사실 | 근거 |
|---|---|
| **M1/M2/M3에는 bf16 하드웨어 가속이 없다. 네이티브 bf16은 M4부터.** 4096² matmul: fp16 14.5 ms / fp32 15.9 ms / **bf16 30.3 ms** | https://lilting.ch/en/articles/comfyui-qwen-mps-bf16-slowdown |
| **fp16 어텐션은 macOS 14.5+ MPS에서 검은 이미지를 낸다**(PyTorch MPS 버그). 그래서 "fp16 linear + fp32 attention upcast" 조합이 필요 | 〃 |
| **FP8 체크포인트는 MPS에서 네이티브로 못 돈다 → 로드 시 bf16으로 환원**. 즉 스펙 §A-7의 lightx2v fp8 20.5 GB는 **macOS에서 메모리 이득이 0** | 〃 |
| ComfyUI + GGUF Q8_0 on MPS: 3:12에 **출력이 흐림** | 〃 |
| diffusers GGUF on MPS: *"MPS device does not support linear for non-float inputs"* — GGML 텐서가 `torch.uint8`이라 `F.linear`가 깨진다 | city96/ComfyUI-GGUF #454, diffusers GGUF 문서 |
| **bitsandbytes MPS PR #1853은 closed(미머지)**. 사유: *"we're not interested in having a separate, unaffiliated dependency for this"* | https://github.com/bitsandbytes-foundation/bitsandbytes/pull/1853 |
| 대신 **PR #1875가 머지**(2026-02-19, milestone v0.50.0). Hub의 `kernels-community` / `medmekk/bitsandbytes-mps` 커널에 위임하는 방식 | https://github.com/bitsandbytes-foundation/bitsandbytes/pull/1875 |
| **bitsandbytes 공식 설치 가이드에 Metal/MPS 섹션이 없다.** `macOS arm64 / Apple Clang 17` 항목은 **CPU 섹션 표**에만 있다 | https://huggingface.co/docs/bitsandbytes/main/en/installation |
| transformers 하드웨어 표: bitsandbytes **Metal = 🟡**, torchao Metal = 🟡, GGUF Metal = 🟢, **optimum-quanto Metal = 🟢**, 신규 `Metal` 백엔드(`kernels-community/mlx-quantization-metal-kernels`) = 🟢 2/4/8bit | https://huggingface.co/docs/transformers/main/en/quantization/overview |
| PyPI에 `bitsandbytes` **0.50.2**까지 `macosx_14_0_arm64` 휠이 배포됨 (0.49.2부터 확인) | PyPI JSON API |

> **결론: 스펙 §F-2의 권고 기본값 `IMGEN_QUANT=nf4`는 macOS에서 무효다.** 휠은 설치되지만 공식 문서가 이를 CPU 빌드로만 기술하고, Metal 지원은 hub 커널을 통한 🟡 상태다. NF4를 macOS 기본값으로 삼으면 안 된다. (완전히 불가능하다고까지 단정하지는 않는다 — **실측 미확인**이며 아래 체크리스트에 넣었다.)

### D. 통합 메모리에서 GPU가 쓸 수 있는 한계

| 항목 | 값 | 출처 |
|---|---|---|
| 기본 wired 한도 | 전체 RAM의 **약 66–75%** (RAM 크기에 따라 다름) | 다수 커뮤니티 문서 (아래 링크) |
| 조회 | `sysctl iogpu.wired_limit_mb` | 〃 |
| 상향 | `sudo sysctl iogpu.wired_limit_mb=<MB>` (macOS 14+). macOS 13은 `debug.iogpu.wired_limit` | 〃 |
| 재부팅 시 | **초기화됨**(0 = 기본 75%). 영속화하려면 `/etc/sysctl.conf` | 〃 |
| 권고 | macOS/타 프로세스용으로 **8–16 GB를 남길 것** | 〃 |

출처: https://github.com/ivanopcode/devnote-override-macos-metal-vram-cap · https://modelpiper.com/blog/iogpu-wired-limit-mb-mac · https://osxdaily.com/2025/05/07/how-to-increase-vram-allocation-on-apple-silicon-mac/

**계산.** 편집 루트 피크가 768×432에서 31 GB다.
- **36 GB 머신**: 기본 wired 한도 ≈ 24–27 GB → **부족.** 스왑 → 사실상 정지.
- **48 GB 머신**: 기본 한도 ≈ 32–36 GB → **빠듯하게 들어간다.** 768×432는 될 가능성이 높으나 1024²는 미확인. `iogpu.wired_limit_mb` 상향이 필요할 수 있고, 그건 sudo + 재부팅마다 재설정이라 **일반 사용자에게 요구할 수 없다.**
- **64 GB 머신**: 기본 한도 ≈ 43–48 GB → **여유.** 업스트림 권고와 일치.
- **128 GB**: 문제 없음. 측정 환경 그 자체.

### E. 기성 앱 경로

| 항목 | 값 | 출처 |
|---|---|---|
| Draw Things가 **Qwen Image Edit 2511 공식 지원** | v1.20251223.0부터 (Qwen Image Layered도 함께) | https://x.com/drawthingsapp/status/2005911742078148950 |
| Draw Things **gRPC 서버 CLI 단독 바이너리** (`gRPCServerCLI-macOS`), 포트 **7859**, **GPL-v3** | 앱과 별개로 Releases에서 배포 | https://github.com/drawthingsai/draw-things-community |
| 앱 내장 **HTTP API 서버** (A1111 호환, `POST /sdapi/v1/txt2img` 등), 포트 7860 · "Bridge Mode"는 1.20251007.2 / 1.20251014.0에 추가 | 앱 설정의 API Server | Draw Things 릴리스 노트 / 커뮤니티 |
| ComfyUI on Apple Silicon | 돌아간다. 위 표 5·8·9행이 그 실측 | lilting.ch, soywiz.com, note.com |

---

## 2. 미확인 (근거 없음 — 추정이라고 명시)

| ID | 항목 | 왜 미확인인가 |
|---|---|---|
| **M-1** | **1024²에서의 속도와 메모리** | mlx-gen이 공개한 Qwen 편집 벤치는 전부 **432×240 / 768×432**다. 1024² 행이 하나도 없다. **최우선 실측 항목.** |
| M-2 | 1024² 추정치 | 768×432(0.33 MP) → 1024²(1.05 MP)는 픽셀 3.2배. latent 토큰은 선형, self-attention은 초선형 → **Lightning 4스텝 전체 편집 기준 M5 Max에서 대략 90–180 초로 추정**. **근거 없는 산술 외삽이며 인용 금지.** |
| M-3 | q4(mixed q4/q8) 패키지의 런타임 피크 메모리 | mlx-gen 문서 자체가 *"Not Yet Published As Memory Recommendations ... `Qwen` q4 edit packages"*라고 명시 |
| M-4 | **M1/M2/M3 Max에서의 MLX 속도** | 공개 실측이 전부 **M5 Max**다. M1–M3는 bf16 HW 가속이 없어 M5 수치가 그대로 옮겨가지 않는다. mlx-gen 패키지의 비양자화 경로(VAE·norm·embedding)가 BF16이므로 영향을 받는다 |
| M-5 | 48 GB Mac에서 실제로 도는지 | 업스트림 티어 표에 48 GB 행이 없다(32 → 64로 건너뜀). 31 GB 피크는 산술상 들어가지만 미측정 |
| M-6 | NF4 on MPS 실동작 | bnb 0.50.x + `kernels-community` 커널로 diffusers NF4가 MPS에서 도는지 아무도 보고하지 않았다 |
| M-7 | optimum-quanto int8/fp8 + Qwen-Image-Edit on MPS | transformers 표에서 Metal 🟢지만 **diffusers Qwen 파이프라인 조합의 보고 없음** |
| M-8 | Lightning 4스텝의 **한글 텍스트 렌더링** 품질 | 스펙 B-7과 동일. MLX 경로에서도 미측정 |
| M-9 | Draw Things gRPC/HTTP API가 **마스크 인페인팅·아웃페인팅을 노출하는지** | API 스키마를 직접 읽지 못했다 |
| M-10 | `hanishkeloth/qwen-image-edit-api`의 README 성능표 (M1 45 s / M4 22 s, 512²/10스텝) | **다른 모든 보고와 모순된다**(같은 M1 Max급에서 ComfyUI가 2:33). 저자 주장이며 검증 불가 → **인용하지 않는다** |

---

## 3. 우리 저장소에 붙일 때의 구체안

### 3-1. 원칙 — `cutout-server`가 이미 정답을 갖고 있다

`cutout-server`가 확립한 패턴 그대로다:

| cutout-server의 결정 | imgen-server에 그대로 적용 |
|---|---|
| `_pick_device()` = `cuda > mps > cpu` 자동 감지 | `_pick_backend()` = `cuda → diffusers 경로` / `mps → mlx-gen 경로` / `그 외 → 비활성` |
| **"Docker on macOS는 GPU 불가"** → 네이티브 런처 별도 배포 | 동일. **MLX는 Docker에서 절대 안 된다**(Metal 접근 불가) |
| `mac/launch.command` — uv 자동 설치 → Python → 의존성 → 모델까지 첫 실행 시 자동 | 동일 구조. 다만 **모델이 30 GB**라 다운로드 UX가 달라져야 한다 (§3-3) |
| `package-native.sh` → `genitor-cutout-{mac,win}.zip` → GitHub Releases | `genitor-imgen-mac.zip` 추가 |
| `CutoutInstallModal.jsx` — mac/win/linux 분기 | `ImagenInstallModal.jsx` 신설 (또는 기존 모달 일반화) |
| `PYTORCH_ENABLE_MPS_FALLBACK=1`을 torch import 전에 설정 | **MLX 경로에는 불필요**(torch를 안 쓴다). cutout-server에는 그대로 유지 |

### 3-2. `imgen-server/generator.py` 이중 백엔드

`server.py`·CORS·PNA·`_gen_lock` 직렬화·`/api/health` 응답 스키마는 **전부 그대로 둔다.** `ImagenBackendClient.js`가 읽는 `{ok, ready, device, build, presets}`는 깨지지 않는다.

```python
# imgen-server/generator.py — 골격만
IMGEN_BACKEND = os.environ.get("IMGEN_BACKEND", "auto")   # auto | cuda | mlx

def _pick_backend():
    if IMGEN_BACKEND != "auto":
        return IMGEN_BACKEND
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "mlx"
    return "cuda"
```

**MLX 백엔드 구현 (`generator_mlx.py`)** — mlx-gen의 Python API가 이미 우리가 필요한 모양이다:

```python
from mlxgen import load_generation_model, run_outpaint

# 프로세스당 1회 로드. cutout-server의 ensure_loaded() 패턴 그대로.
_loaded = load_generation_model(
    model="AbstractFramework/qwen-image-edit-2511-8bit",
    image_count=1,
)

# ② 설명으로 편집 (마스크 유무 모두)
result = _loaded.generate_output(
    seed=seed, prompt=prompt, negative_prompt=neg,
    image_paths=[src_png], mask_path=mask_png_or_None,   # 흰=편집, 검=보존
    width=w, height=h, num_inference_steps=4, guidance=1.0,
)

# ③ 아웃페인팅 — 알파 반전 마스크를 우리가 만들 필요가 없다. 패딩만 주면 된다.
results = run_outpaint(
    loaded=_loaded, source_image=src_png,
    padding="0%,10%,0%,10%",      # CSS 순서 top,right,bottom,left
    fill="edge",                  # edge | neutral | solid | blur
    seeds=[seed], prompt=prompt, num_inference_steps=4, guidance=1.0,
)
```

**이 설계가 스펙 대비 줄여 주는 것:**
- 스펙 §답1의 `QwenImageEditInpaintPipeline` 우회와 그 최우선 미검증 항목 **B-1이 macOS 경로에서 사라진다** (mlx-gen이 EditPlus 조건화 + latent 블렌딩을 이미 구현·검증).
- 스펙 §E-4의 아웃페인팅 절차(알파 추출 → 반전 → 평탄화 → 리사이즈 → 페더 합성) 대부분이 **`run_outpaint`의 `fill` + `original pixels restored`로 대체**된다. 다만 프론트가 보내는 것은 *이미 contain-fit 합성된 투명 알파 PNG*이므로, **패딩 비율로 환산해서 넘기든지 알파 마스크를 그대로 `mask_path`로 넘기든지 둘 중 하나를 골라 실측해야 한다**(체크리스트 참조).
- 스펙 §A-8의 스케줄러 교체(`base_shift=log(3)`, `shift_terminal=None`)를 **우리가 안 해도 된다.**

**남는 것:**
- 마스크 극성 변환(§E-2 알파 반전)은 그대로 필요. mlx-gen도 흰=편집이다.
- 페더링은 그대로 우리 책임 (mlx-gen도 50% 이진화).
- 출력 리사이즈: mlx-gen은 `--width`/`--height`를 받으므로 스펙 §답1 제약 1(1024² 강제)이 없다. 다만 `source-aspect` 기본 정책과 `--resize-mode resize|crop|pad`를 확인해야 한다.
- 프리셋: `QIE_FAST_4`(Lightning 4스텝, g1) / `QIE_STD_20`(20스텝, g4) 두 개면 충분하다. `/api/health`의 `presets`는 백엔드별로 다른 목록을 반환하면 된다.

### 3-3. 30 GB 모델 다운로드 UX — cutout과 결정적으로 다른 지점

cutout은 BiRefNet 하나(~1 GB)라 "첫 실행 시 자동"이 통했다. **30 GB는 안 통한다.**

- mlx-gen은 **명시적 다운로드를 요구**한다: *"Runtime constructors and generation calls do not download missing artifacts."* → `DownloadRequiredError`를 던지고 `download_command`를 준다. **이 설계가 우리에게 유리하다.**
- 런처(`mac/launch.command`)가 해야 할 일:
  1. `uv tool install --upgrade mlx-gen`
  2. **디스크 여유 확인** (≥ 40 GB) — 없으면 즉시 안내 후 중단
  3. **물리 메모리 확인** (`sysctl hw.memsize`) — < 48 GB면 **경고 후 진행 여부를 사용자에게 묻는다**
  4. `mlxgen download --model AbstractFramework/qwen-image-edit-2511-8bit` (진행률 표시)
  5. `uvicorn server:app --host 0.0.0.0 --port 8323`
- `/api/health`는 다운로드 중에도 200을 주되 `ready: false`로 응답하고, **`download_progress` 필드를 추가**한다(기존 필드는 유지 → 프론트 무해). 프론트는 나중에 이 필드를 써서 진행률을 보여줄 수 있다.
- `/api/health`의 `device`는 `"mps (mlx-gen q8)"` 같은 문자열로 — `ImagenBackendClient`가 그대로 표시한다.

### 3-4. 프론트 (`ImagenInstallModal`)

`CutoutInstallModal.jsx`를 그대로 본뜨되 **하드웨어 게이트 문구가 추가돼야 한다**:

| OS | 안내 |
|---|---|
| mac (Apple Silicon) | 네이티브 런처 **권장**. 단 **"통합 메모리 64 GB 이상 권장, 48 GB 최소, 36 GB 이하는 지원하지 않음"**과 **"약 30 GB 다운로드 / 40 GB 여유 디스크 필요"**를 앞에 명시 |
| mac (Intel) | **미지원.** MLX는 Apple Silicon 전용 |
| win (NVIDIA) | Docker 또는 네이티브 CUDA (스펙 §F 그대로) |
| linux | Docker `--gpus all` |
| 전 OS 공통 | "GPU가 없거나 메모리가 부족하면 **설정에서 원격 엔드포인트 URL**을 넣어 사내/클라우드 GPU를 쓸 수 있습니다" (§4-1) |

Docker 섹션은 mac에서 **띄우지 않는다.** cutout은 "느리지만 CPU로 돈다"였지만, 이 모델은 CPU로 돌지 않는다(20B). 잘못된 기대를 만들면 안 된다.

---

## 4. 차선책 — 64 GB 미만 Mac 사용자에게 무엇을 주나

우선순위 순.

### 4-1. **원격 엔드포인트 (1순위, 코드 변경 거의 없음)**

`ImagenBackendClient.js`가 **이미 지원한다**:

```js
// src/core/ImagenBackendClient.js
// localStorage['imagen-backend-url'] > VITE_IMAGEN_BACKEND_URL > http://localhost:8323
export function setImagenBase(url) { … }
export async function probeImagenBackend(base = getImagenBase()) { … }
```

`probeImagenBackend`가 임의 URL을 즉시 검사하도록 이미 만들어져 있다. 필요한 것은 **설정 UI에 URL 입력란 하나**뿐이다. 서버 쪽은 CUDA 경로(스펙 §F-2 NF4 24 GB)를 그대로 쓰면 되므로 **추가 개발이 0에 가깝다.**

- 사내 GPU 서버 / RunPod / vast.ai 프록시를 그대로 붙일 수 있다.
- Mac 사용자에게 "로컬은 못 주지만 팀 서버 주소를 넣으면 된다"는 명확한 답을 준다.
- **이것이 실질적으로 가장 좋은 차선책이다.**

### 4-2. **OpenAI 백엔드 유지 (2순위, 현상 유지)**

`hasApiKey()` 게이트가 이미 있고 4작업 전부 OpenAI 경로가 살아 있다. Mac 사용자에게 기능이 사라지지 않는다. **아무 것도 안 해도 되는 안전망.**

### 4-3. **더 가벼운 편집 모델로 Mac 전용 폴백 (3순위, 검토 가치 있음)**

같은 mlx-gen이 훨씬 가벼운 편집 루트를 갖고 있고, **업스트림이 32 GB 이하 티어에 명시적으로 추천한다**:

| 모델 | 패키지 | 피크 RSS (공개 실측) | 티어 권고 |
|---|---|---|---|
| `AbstractFramework/flux.2-klein-4b-8bit` | 8.0 GiB | **9.23 GiB** (512px, 4스텝) | 18 GB부터 |
| `AbstractFramework/z-image-turbo-8bit` (native inpaint) | 10.2 GiB | **10.57 GiB** (768×432, 9스텝) | 24 GB부터 |
| `AbstractFramework/ernie-image-turbo-8bit` | 11.5 GiB | 12.9 GiB (512px, 8스텝) | 18 GB부터 |
| (참고) Qwen Edit 2511 q8 | 28.3 GiB | 30.91 GiB | 64 GB부터 |

- **마스크 인페인팅 매트릭스에서 `flux.2-klein-4b-8bit`은 4개 채점 케이스 전부 PASS**(Qwen 2511 q8과 동급 평가). Z-Image Turbo도 PASS.
- 아웃페인팅에서는 Klein 4B distilled q8이 **8.4 초** — Qwen의 198.5 초 대비 24배 빠르다.
- ⚠️ **FLUX.2 Klein 9B는 gated + 비상업 라이선스를 상속한다**(mlx-gen 문서 명시). 4B distilled의 라이선스는 별도 확인 필요. 우리 저장소는 Apache-2.0 제품이므로 **이 확인 없이는 채택 불가.**
- 트레이드오프: 레이아웃 보존력·다국어 텍스트 렌더링은 Qwen 2511이 우위라는 게 업스트림 평가다(*"strong layout-preserving edit"*). 슬라이드용 이미지에 한글이 자주 들어가는 우리 용도에는 불리할 수 있다 → **실측 필요.**

### 4-4. **Draw Things 프록시 (4순위, 권장하지 않음)**

- 되는 것: 2511 공식 지원(v1.20251223.0+), `gRPCServerCLI-macOS` 단독 바이너리(포트 7859), 앱 내장 A1111 호환 HTTP API(포트 7860).
- 안 되는 이유:
  - 사용자가 **별도 앱을 설치하고 모델을 받고 API 서버를 켜야** 한다. 우리 원클릭 런처 UX가 깨진다.
  - gRPC 서버 CLI는 **GPL-v3**. 별도 프로세스로 실행하는 것이므로 우리 Apache-2.0 코드에 라이선스가 전염되지는 않지만, 배포 zip에 동봉하는 순간 이야기가 달라진다. **동봉 금지, 사용자 설치 안내만.**
  - **마스크 인페인팅·아웃페인팅을 API로 노출하는지 미확인(M-9).** 그것이 없으면 우리 4작업 중 2개가 안 된다.
- 메모리 문제를 해결해 주지도 않는다. 같은 20B 모델이다.

---

## 5. 실측 체크리스트 — Mac에서 이것만 돌려보면 확정된다

권장 검증 머신: **M4/M5 Max, 64 GB 이상.** 48 GB 머신이 하나 더 있으면 M-5까지 닫힌다.

### 1순위 — 이게 안 되면 판정이 바뀐다

```sh
uv tool install --upgrade mlx-gen
mlxgen download --model AbstractFramework/qwen-image-edit-2511-8bit
mlxgen capabilities --model AbstractFramework/qwen-image-edit-2511-8bit   # supports_mask=true 확인
```

- [ ] **M-1: 1024×1024, Lightning 4스텝, 마스크 없는 편집 1회.** 벽시계 시간 + `/usr/bin/time -l`의 maximum resident set size 기록. **이 한 줄이 이 문서 전체에서 가장 중요한 미확인 항목이다.**
- [ ] **M-1: 1024×1024 마스크 편집** (`--mask-path`). 768×432 → 1024²의 실제 스케일링 계수 확정
- [ ] **마스크 밖 픽셀이 원본과 일치하는지** numpy diff. mlx-gen의 "blending unmasked latents back each step"이 VAE 왕복 열화를 남기는지, 아니면 실제로 비트 단위 복원인지 확인 (아웃페인팅은 `outpaint_source_restore_applied: true`로 원본 복원이 확정이지만, **마스크 편집 루트는 그 보장이 문서화돼 있지 않다**)
- [ ] **우리 실제 입력으로 아웃페인팅**: `composeContainFit`이 만든 투명 알파 PNG를 (a) 알파 반전 마스크 + `mask_path`로, (b) 패딩 비율 계산 후 `run_outpaint(padding=…)`로 각각 실행해 비교. **어느 쪽이 이음매가 나은지가 §3-2 설계를 확정한다**
- [ ] **M-8: 한글 텍스트가 든 슬라이드 캡처**로 Lightning 4스텝 vs 20스텝 비교. 글자가 뭉개지면 기본 프리셋을 20스텝으로 바꿔야 하고, 그러면 1024² 소요가 10배 늘어 판정이 (나)로 내려간다

### 2순위 — 배포 구성 확정

- [ ] **M-3: q4 패키지**(`qwen-image-edit-2511-4bit`, 18.3 GB) 피크 RSS 측정. **48 GB / 36 GB 티어를 열 수 있는 유일한 카드다**
- [ ] **M-5: 48 GB 머신에서 q8이 스왑 없이 도는지.** `memory_pressure` 모니터링 + `sysctl iogpu.wired_limit_mb` 기본값 기록
- [ ] **모델 로드 시간** (콜드 / 페이지 캐시 웜). 워밍업 정책 결정용. Ideogram fp8이 ~3.6분이었다
- [ ] **T2I**: `mlxgen download --model AbstractFramework/qwen-image-2512-8bit` 후 1024² 생성. 편집(31 GB)과 T2I(10.7 GiB)의 메모리 격차가 실제인지 확인. **실제라면 T2I는 저사양 Mac에도 줄 수 있다**
- [ ] **두 모델 병행 상주 가능 여부.** MLX 패키지는 TE를 각자 담고 있어 스펙 §A-6의 "TE·VAE 공유로 증분 = 트랜스포머 1개"가 **MLX 경로에서는 성립하지 않을 가능성이 높다** → 순차 로드/언로드 설계가 필요할 수 있다
- [ ] **M-4: M1/M2/M3 Max 64 GB가 있으면** 같은 벤치 1회. bf16 HW 부재의 실제 페널티 확인

### 3순위 — 기각된 경로의 확인사살 (선택)

- [ ] **M-6: diffusers + bnb NF4 on MPS.** `bitsandbytes>=0.50.0` 설치 후 `PipelineQuantizationConfig(quant_backend="bitsandbytes_4bit", …)` + `.to("mps")`. 예외 메시지를 기록하면 문서가 확정된다
- [ ] **M-7: optimum-quanto int8** + `QwenImageEditPlusPipeline` on MPS. transformers 표에서 Metal 🟢인 유일한 범용 백엔드
- [ ] 신규 `Metal` 양자화 백엔드(`kernels-community/mlx-quantization-metal-kernels`)가 diffusers에서도 쓰이는지

### 4순위 — 차선책 검증

- [ ] **4-3: `flux.2-klein-4b-8bit`의 라이선스 확인** (9B는 gated/비상업 상속이 명시돼 있다. 4B는?). Apache/MIT가 아니면 이 선택지는 죽는다
- [ ] 4-3 채택 시: 같은 슬라이드 입력으로 Qwen 2511 q8 vs Klein 4B q8 편집 품질 A/B (특히 한글 텍스트 보존)
- [ ] **M-9: Draw Things gRPC/HTTP API에 마스크·아웃페인팅 파라미터가 있는지** — 없으면 4-4는 완전히 기각

---

## 부록. 이 문서가 스펙(`local-image-edit-server-spec.md`)을 정정하는 지점

| 스펙 | macOS에서의 정정 |
|---|---|
| §F-2 권고 기본값 `IMGEN_QUANT=nf4` | **무효.** bitsandbytes는 macOS에서 GPU 백엔드가 🟡 실험적이고 공식 문서상 CPU 빌드다 |
| §A-7 FP8 e4m3fn 20.5 GB | **macOS에서 메모리 이득 0.** MPS에 fp8 연산이 없어 로드 시 bf16 환원 |
| §A-7 GGUF Q4_K_M 13.24 GB | **macOS에서 실용 불가.** diffusers 경로는 uint8 linear 미지원으로 파손, ComfyUI 경로는 흐린 출력 또는 13분~51분 |
| §답1 `QwenImageEditInpaintPipeline` 우회 + 최우선 미확인 B-1 | **macOS 경로에는 불필요.** mlx-gen의 `qwen.inpaint`가 §G-2(ii) 방식(EditPlus 조건화 + latent 블렌딩)을 이미 구현·검증 |
| §답1 제약 1 "`height`/`width` 무시, 항상 1024² 면적" | mlx-gen은 `--width`/`--height`를 받는다. 캔버스 정책(`source-aspect` / `exact-resize`)과 `--resize-mode` 확인 필요 |
| §A-8 Lightning 스케줄러 수동 교체 | mlx-gen이 내부 처리. `--lora-paths` + `--steps 4 --guidance 1`만 주면 된다 |
| §A-6 "TE·VAE 공유 → 병행 적재 증분 = 트랜스포머 1개" | **MLX 패키지에는 적용되지 않을 가능성이 높다.** 각 패키지가 `text_encoder/`를 자체 보유한다(15.5 GB) — 실측 필요 |
| §F-3 Dockerfile 변경점 | **macOS에는 Docker 경로 자체가 없다.** Metal 접근 불가. 네이티브 런처만 |
| README `IMGEN_DEVICE` 기본 `cuda` | `IMGEN_BACKEND=auto` 도입 후 darwin/arm64에서 `mlx` 자동 선택 |

---

## 부록. 출처 목록

**MLX 경로**
- https://github.com/lpalbou/mlx-gen (MIT) — README, `docs/quantization.md`, `docs/recommendations.md`, `docs/masked-editing.md`, `docs/edit-capabilities.md`, `docs/reframe-outpaint.md`, `docs/python-integration.md`, `docs/faq.md`
- https://github.com/lpalbou/mlx-gen/blob/main/docs/assets/validation/qwen-inpaint-2026-06-15/qwen2511_q8_inpaint_lightning_stats_m5max.json — **M5 Max 실측 원본**
- https://github.com/lpalbou/mlx-gen/blob/main/docs/assets/validation/qwen-inpaint-2026-06-15/qwen2511_q8_inpaint_lightning_command_log.md — 재현 명령 전문
- https://github.com/filipstrand/mflux (MIT) · https://github.com/filipstrand/mflux/blob/main/src/mflux/models/qwen/README.md
- https://huggingface.co/AbstractFramework/qwen-image-edit-2511-8bit · `-4bit` · https://huggingface.co/AbstractFramework/qwen-image-2512-8bit
- https://huggingface.co/mlx-community/qwen-image-edit-2511-8bit
- https://pypi.org/project/mlx-gen/ · https://pypi.org/project/mlx/

**PyTorch MPS · 양자화**
- https://lilting.ch/en/articles/comfyui-qwen-mps-bf16-slowdown — M1 Max 64 GB 실측, bf16/fp16/fp32 matmul 벤치, fp8·GGUF의 MPS 한계
- https://huggingface.co/docs/transformers/main/en/quantization/overview — 백엔드 × 하드웨어(Metal 포함) 표
- https://huggingface.co/docs/bitsandbytes/main/en/installation — macOS arm64가 CPU 섹션에만 있음
- https://github.com/bitsandbytes-foundation/bitsandbytes/pull/1853 (closed) · https://github.com/bitsandbytes-foundation/bitsandbytes/pull/1875 (merged, v0.50.0)
- https://huggingface.co/docs/diffusers/en/quantization/gguf · https://github.com/city96/ComfyUI-GGUF/issues/454
- https://huggingface.co/docs/diffusers/en/optimization/mps

**실사용 보고**
- https://soywiz.com/qwen_image_edit/ — MacBook M1 Max 64 GB, ComfyUI + GGUF + Lightning, 1024², 3~4분
- https://note.com/minamotomasaru/n/nbc9154a491c6 — Mac mini M4 32 GB, Qwen-Image-2512 Q4_K_M, 512²/20스텝 13:29 · 1024²/40스텝 51:33
- https://github.com/ivanfioravanti/qwen-image-mps — diffusers MPS + Lightning CLI (참고용, 타이밍 미공개)
- https://github.com/hanishkeloth/qwen-image-edit-api — MPS FastAPI 선례 (README 성능표는 **다른 보고와 모순 → 인용하지 않음**)

**통합 메모리**
- https://github.com/ivanopcode/devnote-override-macos-metal-vram-cap · https://modelpiper.com/blog/iogpu-wired-limit-mb-mac · https://osxdaily.com/2025/05/07/how-to-increase-vram-allocation-on-apple-silicon-mac/

**기성 앱**
- https://x.com/drawthingsapp/status/2005911742078148950 — 2511 지원 (v1.20251223.0)
- https://github.com/drawthingsai/draw-things-community (GPL-v3, gRPC 포트 7859)

**우리 저장소 (읽기만 함, 수정 없음)**
- `docs/local-image-edit-server-spec.md` · `cutout-server/{segmenter.py,README.md,package-native.sh,mac/launch.command,win/launch.bat}` · `imgen-server/{generator.py,server.py,README.md,Dockerfile,requirements.txt}` · `src/components/CutoutInstallModal.jsx` · `src/core/ImagenBackendClient.js`
