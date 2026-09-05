# 로컬 이미지 편집 서버 교체 스펙 — Ideogram 4 → Qwen-Image-Edit-2511

`imgen-server/`를 **Ideogram 4 (fp8)** 에서 **Qwen-Image-Edit-2511 (Apache-2.0)** 으로 교체하기 위한 기술 스펙.

**작성 시점**: 2026-09-05 · **성격**: 리서치 산출물(설계 문서). 이 문서를 쓰는 과정에서 소스 코드는 수정하지 않았다.

## 왜 교체하나

현재 `imgen-server/`는 `ideogram-ai/ideogram-4-fp8`을 쓴다. 문제가 셋이다.

1. **라이선스** — 게이트 + 비상업. 이 저장소 자체는 Apache-2.0 제품이다. `HF_TOKEN` 필수.
2. **VRAM** — 추론 피크 ~32 GB(fp8, 1024²) → 40 GB급 이상 필요. 소비자 GPU 불가.
3. **텍스트→이미지 전용** — 편집을 못 한다.

그런데 프론트엔드가 실제로 요구하는 이미지 작업 4가지 중 **3개가 편집 계열**이다 (`src/core/imageJobRunner.js`).

| # | 작업 | 프론트 함수 | 실제 요구 |
|---|---|---|---|
| 1 | 텍스트박스 → 이미지 생성 | `startTextToImageJob` | 순수 T2I |
| 2 | 설명으로 편집 | `startImageEditJob` | `editImage(입력, 프롬프트, 선택적 mask)` = 명령형 편집 + 인페인팅 |
| 3 | 여백까지 그림 채우기 | `startOutpaintJob` | contain-fit 합성 이미지(빈 영역 = **투명 알파**)를 채우기 = **아웃페인팅** |
| 4 | 이미지 생성(선택영역/슬라이드 전체) | `startInfographicJob` | 캡처 → `editImage` = img2img |

---

## 0. 확정 / 미확인 요약표

이 문서에서 **확정**은 공식 모델카드·HF API 응답·diffusers 소스를 직접 읽어 확인한 것만이다. 나머지는 전부 **미확인**으로 표시했고, 본문에서 둘을 섞지 않는다.

### 확정 (근거 명시)

| 항목 | 결론 | 근거 |
|---|---|---|
| 라이선스 | Edit-2511 / Image-2512 둘 다 **Apache 2.0** | 모델카드 YAML + 본문 |
| HF 게이트 | **없음** (`gated: false`) → **`HF_TOKEN` 불필요** | HF API `/api/models/...` |
| 파이프라인 클래스 | `QwenImageEditPlusPipeline` | `model_index.json` `_class_name` |
| `__call__` 시그니처 | §A-2 전문 | diffusers 소스 |
| **EditPlus는 픽셀을 보존하지 않는다** | 순수 노이즈에서 시작. 입력은 "참조 토큰"일 뿐 | `pipeline_qwenimage_edit_plus.py` `prepare_latents` |
| EditPlus 마스크 지원 | **없음** (`mask_image` 인자 자체가 없음) | 시그니처 |
| `image=None` T2I | **불가 — `AttributeError` 즉시 예외** | `pipeline_qwenimage_edit_plus.py:645` |
| Inpaint 파이프라인 + 2511 | **로드 가능** (컴포넌트 6개 완전 일치) | 두 `__init__` 대조 + `model_index.json` |
| Inpaint 픽셀 보존 | **된다 — 3겹** (img2img 초기화 + latent 블렌딩 + `apply_overlay`) | §답1 |
| Inpaint `height`/`width` | **무시됨** (항상 1024² 면적) | `pipeline_qwenimage_edit_inpaint.py:784-789` |
| 마스크 극성 | **흰(255) = 편집, 검(0) = 보존** | `mask_image` docstring |
| 우리 마스크 형식 | **투명 = 편집, 불투명 = 보존** → 알파 반전하면 일치 | `MaskBrushOverlay.jsx:117-138` |
| RGBA 직접 입력 | **깨진다** (`do_convert_rgb=False` → 4채널) | `image_processor.py` |
| TE·VAE 공유 | **비트 단위 동일** (SHA256 8/8 일치) → 병행 적재 증분 = 트랜스포머 1개 | HF `x-linked-etag` 대조 |
| 가중치 크기 | transformer 40.86 GB / TE 16.58 GB / VAE 0.25 GB = **57.7 GB** | HF blob 크기 |
| FP8 체크포인트 | `lightx2v/...` **20.49 GB** (준공식) | HF 파일 목록 |
| GGUF 체크포인트 | `unsloth/...` Q8_0 21.76 / Q4_K_M 13.24 GB (커뮤니티) | HF 파일 목록 |
| Qwen 공식 양자화 | **없음** — org 전체가 bf16 | HF org 목록 |
| Lightning 스케줄러 설정 | `base_shift=max_shift=log(3)`, `shift_terminal=None` 필수 | ModelTC 공식 스크립트 |

### 미확인 — GPU 실측 필요

| ID | 항목 |
|---|---|
| B-1 | **Inpaint 파이프라인 + 2511의 출력 품질** (프롬프트 템플릿·조건 해상도 불일치) ← 최우선 |
| B-2 | 단색 캔버스로 T2I 흉내내기의 품질 (공식 근거 전무) |
| B-3 | lightx2v fp8-**scaled** 단일파일의 `from_single_file` 로드 가능 여부 |
| B-4 | GGUF(`GGUFQuantizationConfig`)로 2511 로드 가능 여부 |
| B-5 | **실측 피크 VRAM** (본 문서의 수치는 전부 가중치 크기 산술합) |
| B-6 | **실측 추론 속도** (공식 문서에 초당 수치 없음) |
| B-7 | Lightning 4스텝 LoRA의 텍스트 렌더링 품질 저하 |
| B-8 | 아웃페인팅 알파 평탄화 배경색 / 페더 폭 최적값 |
| B-9 | 안전 필터 유무 (문서화된 바 없음 = 사실상 없음이나 적극 근거도 없음) |
| B-10 | `padding_mask_crop` 최적값 |
| B-11 | LoRA 어댑터가 컴포넌트 공유 파이프라인 양쪽에 함께 적용되는지 |

---

# A. 확인된 사실

## A-1. 모델 · 라이선스 · 게이트

| 항목 | 값 | 근거 |
|---|---|---|
| 편집 모델 repo | `Qwen/Qwen-Image-Edit-2511` | https://huggingface.co/Qwen/Qwen-Image-Edit-2511 |
| T2I 모델 repo | `Qwen/Qwen-Image-2512` | https://huggingface.co/Qwen/Qwen-Image-2512 |
| 라이선스 | 둘 다 **Apache 2.0** | 모델카드 YAML `license: apache-2.0`, 본문 *"Qwen-Image is licensed under Apache 2.0"* |
| HF 게이트 | **없음** | HF API `/api/models/Qwen/Qwen-Image-Edit-2511` → `"gated": false` |
| 결론 | **`HF_TOKEN` 불필요.** 익명 다운로드 가능 | 위 두 줄 |

> Ideogram 대비 두 문제(게이트 + 비상업)가 완전히 해소된다. 상업적 사용 가능, 토큰 불필요.

**Qwen org 전체 이미지 모델 목록** (HF API `?author=Qwen&search=Qwen-Image`):
`Qwen-Image`, `Qwen-Image-2512`, `Qwen-Image-Edit`, `Qwen-Image-Edit-2509`, `Qwen-Image-Edit-2511`, `Qwen-Image-Layered`, `Qwen-Image-Bench` — **전부 gated: false, 전부 bf16.**

`Qwen/Qwen-Image-Layered`(`QwenImageLayeredPipeline`, image-text-to-image)는 이미지를 레이어로 분해하는 모델이다. 현재 `startCutoutJob`은 별도 cutout-server를 쓰고 있으니 지금 범위는 아니지만, 장기적으로 대체 후보로 기억해 둘 만하다.

## A-2. diffusers 파이프라인 클래스와 정확한 `__call__` 시그니처

`Qwen/Qwen-Image-Edit-2511/model_index.json`:

```json
{
  "_class_name": "QwenImageEditPlusPipeline",
  "_diffusers_version": "0.36.0.dev0",
  "processor":    ["transformers", "Qwen2VLProcessor"],
  "scheduler":    ["diffusers", "FlowMatchEulerDiscreteScheduler"],
  "text_encoder": ["transformers", "Qwen2_5_VLForConditionalGeneration"],
  "tokenizer":    ["transformers", "Qwen2Tokenizer"],
  "transformer":  ["diffusers", "QwenImageTransformer2DModel"],
  "vae":          ["diffusers", "AutoencoderKLQwenImage"]
}
```

diffusers `main` / `src/diffusers/pipelines/qwenimage/pipeline_qwenimage_edit_plus.py` 원문:

```python
def __call__(
    self,
    image: PipelineImageInput | None = None,
    prompt: str | list[str] = None,
    negative_prompt: str | list[str] = None,
    true_cfg_scale: float = 4.0,
    height: int | None = None,
    width: int | None = None,
    num_inference_steps: int = 50,
    sigmas: list[float] | None = None,
    guidance_scale: float | None = None,
    num_images_per_prompt: int = 1,
    generator: torch.Generator | list[torch.Generator] | None = None,
    latents: torch.Tensor | None = None,
    prompt_embeds: torch.Tensor | None = None,
    prompt_embeds_mask: torch.Tensor | None = None,
    negative_prompt_embeds: torch.Tensor | None = None,
    negative_prompt_embeds_mask: torch.Tensor | None = None,
    output_type: str | None = "pil",
    return_dict: bool = True,
    attention_kwargs: dict[str, Any] | None = None,
    callback_on_step_end: Callable[[int, int], None] | None = None,
    callback_on_step_end_tensor_inputs: list[str] = ["latents"],
    max_sequence_length: int = 512,
):
```

**공식 모델카드 권장 호출값**:

```python
inputs = {
    "image": [image1, image2],      # 리스트
    "prompt": prompt,
    "generator": torch.manual_seed(0),
    "true_cfg_scale": 4.0,
    "negative_prompt": " ",         # 공백 1칸
    "num_inference_steps": 40,
    "guidance_scale": 1.0,
    "num_images_per_prompt": 1,
}
```

### 소스에서 확인한 동작 세부

**(1) `guidance_scale`은 무시된다.** `transformer/config.json`에 `"guidance_embeds": false` → 파이프라인이 경고만 찍고 버린다. 모델카드 예제의 `guidance_scale=1.0`은 무해하지만 의미 없다. **`None`으로 두는 게 맞다.**

```json
// Qwen/Qwen-Image-Edit-2511/transformer/config.json
{
  "_class_name": "QwenImageTransformer2DModel",
  "attention_head_dim": 128, "axes_dims_rope": [16, 56, 56],
  "guidance_embeds": false, "in_channels": 64, "joint_attention_dim": 3584,
  "num_attention_heads": 24, "num_layers": 60, "out_channels": 16,
  "patch_size": 2, "zero_cond_t": true
}
```

`zero_cond_t: true`는 2511에만 있는 신규 플래그다. `Qwen/Qwen-Image-2512`와 `Qwen/Qwen-Image-Edit`의 config에는 없다. 그 외 형상은 셋 다 동일하다(`in_channels=64, out_channels=16, num_layers=60`).

**(2) 해상도 결정** (`pipeline_qwenimage_edit_plus.py:645-655`):

```python
image_size = image[-1].size if isinstance(image, list) else image.size
calculated_width, calculated_height = calculate_dimensions(1024 * 1024, image_size[0] / image_size[1])
height = height or calculated_height
width  = width  or calculated_width

multiple_of = self.vae_scale_factor * 2      # = 16
width  = width  // multiple_of * multiple_of
height = height // multiple_of * multiple_of
```

- `vae_scale_factor = 2 ** len(self.vae.temperal_downsample)`. VAE config `temperal_downsample = [False, True, True]` → **8**. 따라서 `multiple_of = 16`.
- **출력 W/H는 16의 배수로 내림**된다.
- `height`/`width`를 명시하면 **임의 종횡비 출력이 가능**하다. (Inpaint 파이프라인은 그렇지 않다 — §답1 참조)

```python
def calculate_dimensions(target_area, ratio):
    width = math.sqrt(target_area * ratio)
    height = width / ratio
    width  = round(width / 32) * 32
    height = round(height / 32) * 32
    return width, height
```

**(3) 입력 이미지는 두 번 리사이즈된다** (`:66-67`, `:699-705`):

```python
CONDITION_IMAGE_SIZE = 384 * 384    # VL 텍스트 인코더용
VAE_IMAGE_SIZE = 1024 * 1024        # VAE 참조 latent용
```

각각 종횡비를 유지한 채 32배수로 반올림된다. 즉 **입력 이미지의 원래 해상도는 유지되지 않는다.**

**(4) 프롬프트 템플릿** (`:215`, `:238`):

```python
self.prompt_template_encode = (
    "<|im_start|>system\nDescribe the key features of the input image (color, shape, size, texture, "
    "objects, background), then explain how the user's text instruction should alter or modify the image. "
    "Generate a new image that meets the user's requirements while maintaining consistency with the original "
    "input where appropriate.<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n")
self.prompt_template_encode_start_idx = 64

# _get_qwen_prompt_embeds 내부
img_prompt_template = "Picture {}: <|vision_start|><|image_pad|><|vision_end|>"
```

이 "Picture N:" 다중 이미지 형식이 2511이 학습된 형식이다. (구형 `QwenImageEditPipeline`/`QwenImageEditInpaintPipeline`은 다르다 — §답1 제약 3)

**(5) `batch_size > 1`은 명시적 `ValueError`.**

```python
if batch_size > 1:
    raise ValueError(
        f"QwenImageEditPlusPipeline currently only supports batch_size=1, but received batch_size={batch_size}. ")
```

**(6) 스케줄러 기본 config** (`Qwen/Qwen-Image-Edit-2511/scheduler/scheduler_config.json`):

```json
{
  "_class_name": "FlowMatchEulerDiscreteScheduler",
  "base_image_seq_len": 256, "base_shift": 0.5,
  "invert_sigmas": false, "max_image_seq_len": 8192, "max_shift": 0.9,
  "num_train_timesteps": 1000, "shift": 1.0, "shift_terminal": 0.02,
  "stochastic_sampling": false, "time_shift_type": "exponential",
  "use_dynamic_shifting": true,
  "use_beta_sigmas": false, "use_exponential_sigmas": false, "use_karras_sigmas": false
}
```

Lightning LoRA는 이 값을 바꿔야 한다(§A-8).

## A-3. ⚠️ 가장 중요한 구조적 발견 — EditPlus는 픽셀을 보존하지 않는다

`pipeline_qwenimage_edit_plus.py`의 `prepare_latents`:

```python
if latents is None:
    latents = randn_tensor(shape, generator=generator, device=device, dtype=dtype)
    latents = self._pack_latents(latents, batch_size, num_channels_latents, height, width)
else:
    latents = latents.to(device=device, dtype=dtype)

return latents, image_latents
```

**latents는 순수 노이즈에서 시작한다.** 입력 이미지는 `image_latents`로 VAE 인코딩되어 **시퀀스 축으로 concat되는 "참조 토큰"** 으로만 들어간다:

```python
latent_model_input = latents
if image_latents is not None:
    latent_model_input = torch.cat([latents, image_latents], dim=1)
...
noise_pred = noise_pred[:, : latents.size(1)]     # 참조 토큰 부분은 잘라 버림
```

img2img의 `strength` 인자도 없다.

### 결과

- **출력 이미지는 전체가 새로 생성된다.** 원본과 비트 단위로 같은 영역은 존재하지 않는다.
- 2511이 레이아웃을 잘 지킨다는 것과 "픽셀이 보존된다"는 것은 다른 이야기다.
- 따라서 **인페인팅·아웃페인팅에서 "칠하지 않은 곳은 그대로"를 보장하려면 EditPlus로는 안 된다.** → §답1의 Inpaint 파이프라인 경로가 필요하다.
- 반대로 4번 작업(인포그래픽 = 전체 재해석)에는 EditPlus의 이 성질이 정확히 맞는다.

## A-4. 인페인팅(mask) 지원

**`QwenImageEditPlusPipeline`에는 `mask_image` 인자가 없다** (§A-2 시그니처 참조). 2511의 기본 파이프라인은 마스크를 못 받는다.

마스크 경로는 diffusers의 별도 클래스 **`QwenImageEditInpaintPipeline`** 이다. (2511 가중치로 로드 가능함은 §답1에서 확정)

```python
# pipeline_qwenimage_edit_inpaint.py
def __call__(
    self,
    image: PipelineImageInput | None = None,
    prompt: str | list[str] = None,
    negative_prompt: str | list[str] = None,
    mask_image: PipelineImageInput = None,          # ← 흰=편집, 검=보존
    masked_image_latents: PipelineImageInput = None, # 계산되지만 트랜스포머에 미전달(미사용)
    true_cfg_scale: float = 4.0,
    height: int | None = None,                       # ← 무시됨 (784-789행)
    width: int | None = None,                        # ← 무시됨
    padding_mask_crop: int | None = None,            # ← 주면 크롭+되붙이기까지 수행
    strength: float = 0.6,
    num_inference_steps: int = 50,
    sigmas: list[float] | None = None,
    guidance_scale: float | None = None,
    num_images_per_prompt: int = 1,
    generator: torch.Generator | list[torch.Generator] | None = None,
    latents: torch.Tensor | None = None,
    prompt_embeds: torch.Tensor | None = None,
    prompt_embeds_mask: torch.Tensor | None = None,
    negative_prompt_embeds: torch.Tensor | None = None,
    negative_prompt_embeds_mask: torch.Tensor | None = None,
    output_type: str | None = "pil",
    return_dict: bool = True,
    attention_kwargs: dict[str, Any] | None = None,
    callback_on_step_end: Callable[[int, int], None] | None = None,
    callback_on_step_end_tensor_inputs: list[str] = ["latents"],
    max_sequence_length: int = 512,
):
```

### 마스크 극성 (docstring 원문)

> `mask_image` (...): `Image`, numpy array or tensor representing an image batch to mask `image`. **White pixels in the mask are repainted while black pixels are preserved.** If `mask_image` is a PIL image, it is converted to a single channel (luminance) before use.

→ **흰(255) = 편집, 검(0) = 보존.**

### 마스크 전처리기

```python
self.mask_processor = VaeImageProcessor(
    vae_scale_factor=self.vae_scale_factor * 2,
    vae_latent_channels=self.latent_channels,
    do_normalize=False,
    do_binarize=True,        # ← 0.5 임계 이진화
    do_convert_grayscale=True,
)
```

`binarize`(`image_processor.py:523-535`): *"Values less than 0.5 are set to 0, values greater than 0.5 are set to 1."*

→ **파이프라인 내부 페더링은 없다.** 부드러운 경계가 필요하면 서버가 만들어야 한다.

### 트랜스포머 채널 확장 없음

```python
num_channels_latents = self.transformer.config.in_channels // 4     # = 16
```

즉 **전용 인페인팅 체크포인트가 아니라 범용 latent-블렌딩 인페인트**이고, 그래서 2511 가중치가 그대로 먹힌다.

### EditPlus vs EditInpaint 비교 (전부 소스 확인)

| | `QwenImageEditPlusPipeline` | `QwenImageEditInpaintPipeline` |
|---|---|---|
| 2511 `model_index` 지정 | ✅ 공식 | 로드 가능(컴포넌트 동일) |
| 마스크 | ✗ | ✅ `mask_image` (흰=편집) |
| latent 초기화 | **순수 노이즈** | `scale_noise(image_latents, …)` = img2img |
| `strength` | 없음 | ✅ 기본 0.6 |
| 원본 픽셀 보존 | ✗ | ✅ 3겹 (§답1) |
| `height`/`width` | ✅ 유효 (16배수 내림) | ❌ **무시** (항상 1024² 면적) |
| 다중 이미지 | ✅ `image=[i1, i2]` | ✗ 단일 |
| VL 조건 해상도 | 384² 면적 | 1024² 면적 |
| 프롬프트 템플릿 | `Picture 1: <\|vision_start\|>…` (2511 학습 형식) | 구형 단일 이미지 형식 |
| 2511 품질 | 공식 보증 | **미검증 (B-1)** |

## A-5. 아웃페인팅

**공식 문서·모델카드에 아웃페인팅 언급은 없다.** Qwen 계열 아웃페인팅은 별도 ControlNet(`InstantX/Qwen-Image-ControlNet-Inpainting`)이나 ComfyUI 커뮤니티 워크플로(캔버스 확장 → 인페인트 → 합성)로만 존재한다. 공식 권장 방식이라 부를 만한 것이 없다.

우리 케이스에 대한 **확정 사실 하나**:

diffusers `VaeImageProcessor`는 기본 `do_convert_rgb=False`이고 `pil_to_numpy`가 `np.array(image)`를 그대로 쓴다. → **RGBA PIL을 그대로 넣으면 4채널 배열이 되어 VAE(3채널 기대)에서 깨진다.** 알파 평탄화는 우리 책임이다. (§E-4)

## A-6. 가중치 크기와 컴포넌트 공유

HF API blob 크기(실측):

| 컴포넌트 | Edit-2511 | Image-2512 | SHA256 |
|---|---|---|---|
| `transformer/` | **40.86 GB** (5 샤드) | 40.86 GB (9 샤드) | 상이(다른 모델) |
| `text_encoder/` (Qwen2.5-VL-7B) | 16.58 GB (4 샤드) | 16.58 GB (4 샤드) | **4/4 일치** |
| `vae/` | 0.25 GB | 0.25 GB | **일치** |
| **합계** | **57.7 GB** | 57.7 GB | |

`transformer/` 샤드 내역 (Edit-2511): 9.97 + 9.99 + 9.99 + 9.93 + 0.98 GB
`text_encoder/` 샤드 내역: 4.97 + 4.99 + 4.93 + 1.69 GB

### TE·VAE 공유 확인 방법과 결과

HF의 `resolve` 엔드포인트 HEAD 응답에는 `x-linked-etag` 헤더가 파일의 SHA256으로 실린다. 8개 파일을 대조했다:

| 파일 | SHA256 (앞 16자) | 두 repo |
|---|---|---|
| `vae/diffusion_pytorch_model.safetensors` | `0c8bc8b758c649ab…8344` | 동일 |
| `text_encoder/model-00001-of-00004.safetensors` | `d725335e4ea2399b…fee4` | 동일 |
| `text_encoder/model-00002-of-00004.safetensors` | `b1830db6908dcc76…6de3` | 동일 |
| `text_encoder/model-00003-of-00004.safetensors` | `09c1807c6d00d7ca…5aa6` | 동일 |
| `text_encoder/model-00004-of-00004.safetensors` | `5dd068336d14d45f…1f4a` | 동일 |

→ **`Qwen/Qwen-Image-Edit-2511`과 `Qwen/Qwen-Image-2512`는 text encoder와 VAE를 비트 단위로 공유한다. (확정)**

### 병행 적재 시 증분 메모리

| 양자화 | 증분 VRAM | 증분 디스크 |
|---|---|---|
| bf16 | **+40.9 GB** | +40.9 GB |
| FP8 e4m3fn | **+20.5 GB** | +20.5 GB |
| bnb NF4 | **+11 GB** (산술 추정, 미실측) | (bf16 원본 필요) |

⚠️ 주의: 2512의 `model_index.json`에는 `processor` 키가 **없다**(`QwenImagePipeline`은 VL 프로세서를 쓰지 않음). 2512 파이프라인을 먼저 만들고 Edit을 나중에 붙이는 방향이면 `processor=AutoProcessor.from_pretrained(EDIT_REPO, subfolder="processor")`를 따로 넘겨야 한다.

## A-7. FP8 / GGUF 체크포인트 — 정확한 repo 이름 (공식/커뮤니티 구분)

### ⚠️ Qwen 공식(`Qwen` org)에는 양자화 체크포인트가 하나도 없다

org 전체가 bf16이다(§A-1 목록). 따라서 아래는 전부 서드파티다.

| repo / 파일 | 형식 | 크기 | 성격 | 라이선스 |
|---|---|---|---|---|
| `lightx2v/Qwen-Image-Edit-2511-Lightning` → `qwen_image_edit_2511_fp8_e4m3fn_scaled.safetensors` | FP8 e4m3fn scaled (ComfyUI 단일파일) | **20.49 GB** | **준공식** — Qwen 공식 README가 LightX2V를 가속 파트너로 명시 | Apache-2.0 |
| 〃 `qwen_image_edit_2511_fp8_e4m3fn_scaled_lightning_4steps_v1.0.safetensors` | FP8 + 4스텝 LoRA 융합 | 20.58 GB | 준공식 | Apache-2.0 |
| 〃 `..._lightning_8steps_v1.0.safetensors` | FP8 + 8스텝 LoRA 융합 | 20.49 GB | 준공식 | Apache-2.0 |
| 〃 `..._lightning_comfyui_4steps_v1.0.safetensors` | FP8 + LoRA (ComfyUI 전용) | 20.45 GB | 준공식 | Apache-2.0 |
| 〃 `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | 스텝 증류 **LoRA** | **0.85 GB** | 준공식 | Apache-2.0 |
| 〃 `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors` | 〃 | 1.7 GB | 준공식 | Apache-2.0 |
| 〃 `Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors` | 〃 | 0.85 GB | 준공식 | Apache-2.0 |
| 〃 `Qwen-Image-Edit-2511-Lightning-8steps-V1.0-fp32.safetensors` | 〃 | 1.7 GB | 준공식 | Apache-2.0 |
| 〃 `qwen_image_edit_2511_fp8_e4m3fn_scaled_lightning_split/` | 블록별 분할(60 블록 × 0.34 GB + non_block 0.16 GB) | ~20.5 GB | 준공식 | Apache-2.0 |
| `unsloth/Qwen-Image-Edit-2511-GGUF` | GGUF | Q8_0 **21.76** / Q6_K 16.85 / Q5_1 15.39 / Q5_K_M 15.03 / Q5_0 14.40 / Q5_K_S 14.33 / **Q4_K_M 13.24** / Q4_1 12.84 / Q4_K_S 12.41 / Q4_0 11.85 / Q3_K_L 10.58 / Q3_K_M 9.92 / Q3_K_S 9.22 / Q2_K 7.47 / BF16·F16 40.87 GB | 커뮤니티(평판 양호) | apache-2.0 |
| `1038lab/Qwen-Image-Edit-2511-FP8` → `Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors` | FP8 e4m3fn 단일파일 | 20.43 GB | 커뮤니티 | apache-2.0 |
| `ovedrive/Qwen-Image-Edit-2511-4bit` | bnb NF4, **diffusers 폴더 형식** | — | 커뮤니티 | — |
| `QuantFunc/Nunchaku-Qwen-Image-EDIT-2511` | SVDQuant int4 | — | 커뮤니티(Nunchaku 런타임 별도 필요) | — |
| `Bedovyy/Qwen-Image-Edit-2511-NVFP4` | NVFP4 (Blackwell 전용) | — | 커뮤니티 | — |
| `Disty0/Qwen-Image-Edit-2511-SDNQ-uint4-svd-r32` | SDNQ uint4 | — | 커뮤니티 | — |
| `cardamonnl/Qwen-Image-Edit-2511-int8-convrot` | int8 | — | 커뮤니티 | — |
| `seochan99/Qwen-Image-Edit-2511-bnb-nf4` | bnb NF4 | — | 커뮤니티 | — |

**T2I(2512) 대응**: `lightx2v/Qwen-Image-2512-Lightning`, `unsloth/Qwen-Image-2512-GGUF`, `Ilus-AI/Qwen-Image-2512-FP8`, `QuantFunc/Nunchaku-Qwen-Image-2512`, `mlx-community/Qwen-Image-2512-{4,6,8}bit`.

### diffusers 단일파일 로딩 가능성

`src/diffusers/loaders/single_file_model.py:192`에 엔트리가 **존재**한다:

```python
"QwenImageTransformer2DModel": {
    "checkpoint_mapping_fn": lambda checkpoint, **kwargs: checkpoint,   # 항등 매핑
    "default_subfolder": "transformer",
},
```

`QwenImageTransformer2DModel`도 `FromOriginalModelMixin`을 상속한다(`transformer_qwenimage.py:791-793`).

```python
class QwenImageTransformer2DModel(
    ModelMixin, ConfigMixin, PeftAdapterMixin, FromOriginalModelMixin, CacheMixin, AttentionMixin
):
```

→ 경로는 열려 있다. 다만 `single_file_utils.py`에는 qwen 관련 변환 함수가 **하나도 없다**(항등 매핑이므로 당연). fp8-**scaled** 포맷은 ComfyUI 관례상 `scale_weight` 텐서를 함께 담는데, diffusers가 이를 어떻게 다루는지는 **미확인(B-3)**.

## A-8. Lightning(스텝 증류) — 정확한 설정

`lightx2v/Qwen-Image-Edit-2511-Lightning` 모델카드:
- 라이선스 **apache-2.0**, `gated: false`, `base_model: Qwen/Qwen-Image-Edit-2511`
- *"reduce the original inference steps to just 4 steps, achieving significant speedup (≈10x faster than standard 40-step inference)"*

`ModelTC/Qwen-Image-Lightning`의 `generate_with_diffusers.py` 원문:

```python
scheduler_config = {
    "base_image_seq_len": 256,
    "base_shift": math.log(3),   # We use shift=3 in distillation
    "invert_sigmas": False,
    "max_image_seq_len": 8192,
    "max_shift": math.log(3),    # We use shift=3 in distillation
    "num_train_timesteps": 1000,
    "shift": 1.0,
    "shift_terminal": None,      # set shift_terminal to None
    "stochastic_sampling": False,
    "time_shift_type": "exponential",
    "use_beta_sigmas": False,
    "use_dynamic_shifting": True,
    "use_exponential_sigmas": False,
    "use_karras_sigmas": False,
}
scheduler = FlowMatchEulerDiscreteScheduler.from_config(scheduler_config)
model = QwenImageTransformer2DModel.from_pretrained(model_name, subfolder="transformer", torch_dtype=torch_dtype)
pipe = QwenImageEditPlusPipeline.from_pretrained(
    model_name, transformer=model, scheduler=scheduler, torch_dtype=torch_dtype)
pipe.load_lora_weights(lora_path)
```

같은 스크립트의 네거티브 프롬프트 선택 로직:

```python
if "Qwen-Image-2512" in model_name:
    negative_prompt = "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲。"
else:
    negative_prompt = " "
```

공식 실행 예:
```sh
python generate_with_diffusers.py \
  --model_name Qwen/Qwen-Image-Edit-2511 \
  --lora_path Qwen-Image-Edit-2511-Lightning/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors \
  --base_seed 42 --steps 4 --cfg 1.0
```

### ⚠️ 스케줄러 교체가 필수

| | 2511 repo 기본 | Lightning 요구 |
|---|---|---|
| `base_shift` | 0.5 | `math.log(3)` ≈ 1.0986 |
| `max_shift` | 0.9 | `math.log(3)` |
| `shift_terminal` | 0.02 | **`None`** |

→ **LoRA를 켜고 끌 때 스케줄러도 함께 바꿔야 한다.** (§D-2)

### 연산량 (이론치)

| 프리셋 | 스텝 | true CFG | 트랜스포머 forward |
|---|---|---|---|
| 기본 | 40 | 4.0 (cond + uncond 2회) | **80** |
| Lightning 8-step | 8 | 1.0 (1회) | **8** |
| Lightning 4-step | 4 | 1.0 (1회) | **4** |

4스텝은 기본 대비 **20배 적은 forward**. 다만 **절대 초수는 미확인(B-6)** — Qwen 공식 문서·diffusers 문서 어디에도 2511의 초당 수치가 없다. 개인 블로그의 수치는 신뢰할 수 없어 인용하지 않는다.

## A-9. 2512 (T2I) 참고값

`Qwen/Qwen-Image-2512` 모델카드 권장:

```python
negative_prompt = "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲。"
aspect_ratios = {
    "1:1":  (1328, 1328), "16:9": (1664, 928), "9:16": (928, 1664),
    "4:3":  (1472, 1104), "3:4":  (1104, 1472),
    "3:2":  (1584, 1056), "2:3":  (1056, 1584),
}
image = pipe(prompt=..., negative_prompt=negative_prompt, width=w, height=h,
             num_inference_steps=50, true_cfg_scale=4.0,
             generator=torch.Generator(device="cuda").manual_seed(42)).images[0]
```

---

# 후속 질문 답변

## 답 1 — `QwenImageEditInpaintPipeline`을 2511 체크포인트로 쓸 수 있나? → **쓸 수 있고, 픽셀도 보존된다**

### 1-A. 컴포넌트 호환: 완전 일치 (확정)

두 파이프라인의 `__init__`을 대조했다. **동일한 6개 컴포넌트를 받는다.**

```python
# pipeline_qwenimage_edit_inpaint.py __init__   ── 그리고 pipeline_qwenimage_edit_plus.py __init__ 도 동일
def __init__(
    self,
    scheduler: FlowMatchEulerDiscreteScheduler,
    vae: AutoencoderKLQwenImage,
    text_encoder: Qwen2_5_VLForConditionalGeneration,
    tokenizer: Qwen2Tokenizer,
    processor: Qwen2VLProcessor,
    transformer: QwenImageTransformer2DModel,
):
    super().__init__()
    self.register_modules(vae=vae, text_encoder=text_encoder, tokenizer=tokenizer,
                          processor=processor, transformer=transformer, scheduler=scheduler)
```

`Qwen/Qwen-Image-Edit-2511/model_index.json`의 키가 정확히 이 6개다. →

```python
QwenImageEditInpaintPipeline.from_pretrained("Qwen/Qwen-Image-Edit-2511", torch_dtype=torch.bfloat16)
```
**별도 체크포인트 없이 그대로 로드된다.**

트랜스포머 config도 호환된다 — `in_channels=64 / out_channels=16 / num_layers=60`이 2511·2512·Edit 모두 동일하고, 2511에만 있는 `zero_cond_t: true`는 파이프라인이 아니라 트랜스포머 내부에서 `img_shapes`로부터 일반 처리된다:

```python
# transformer_qwenimage.py:963-970
if self.zero_cond_t:
    timestep = torch.cat([timestep, timestep * 0], dim=0)
    modulate_index = torch.tensor(
        [[0] * prod(sample[0]) + [1] * sum([prod(s) for s in sample[1:]]) for sample in img_shapes],
        device=timestep.device, dtype=torch.int)
else:
    modulate_index = None
```

edit_inpaint가 만드는 `img_shapes`는 `[타깃, 조건1]` 2원소이고 이 로직과 호환된다:

```python
# pipeline_qwenimage_edit_inpaint.py
img_shapes = [[
    (1, height // self.vae_scale_factor // 2, width // self.vae_scale_factor // 2),
    (1, calculated_height // self.vae_scale_factor // 2, calculated_width // self.vae_scale_factor // 2),
]] * batch_size
```

### 1-B. 픽셀 보존: 세 겹으로 확인 (확정)

**(1) img2img 초기화** — EditPlus와 결정적으로 다르다.

```python
# pipeline_qwenimage_edit_inpaint.py prepare_latents
if latents is None:
    noise = randn_tensor(shape, generator=generator, device=device, dtype=dtype)
    latents = self.scheduler.scale_noise(image_latents, timestep, noise)   # ← 원본 latent에서 출발
else:
    noise = latents.to(device)
    latents = noise
```

`strength`가 `get_timesteps`로 시작 타임스텝을 잘라내므로 원본이 실제로 남는다:

```python
def get_timesteps(self, num_inference_steps, strength, device):
    init_timestep = min(num_inference_steps * strength, num_inference_steps)
    t_start = int(max(num_inference_steps - init_timestep, 0))
    timesteps = self.scheduler.timesteps[t_start * self.scheduler.order :]
    if hasattr(self.scheduler, "set_begin_index"):
        self.scheduler.set_begin_index(t_start * self.scheduler.order)
    return timesteps, num_inference_steps - t_start
```

EditPlus는 `latents = randn_tensor(...)` 순수 노이즈였다(§A-3).

**(2) 매 스텝 latent 블렌딩**

```python
# 디노이징 루프 끝
init_latents_proper = image_latents
init_mask = mask
if i < len(timesteps) - 1:
    noise_timestep = timesteps[i + 1]
    init_latents_proper = self.scheduler.scale_noise(
        init_latents_proper, torch.tensor([noise_timestep]), noise)
latents = (1 - init_mask) * init_latents_proper + init_mask * latents
```

**(3) `padding_mask_crop`을 주면 픽셀 단위 되붙이기까지 파이프라인이 수행**

```python
# 전처리
if padding_mask_crop is not None:
    crops_coords = self.mask_processor.get_crop_region(mask_image, width, height, pad=padding_mask_crop)
    resize_mode = "fill"
else:
    crops_coords = None
    resize_mode = "default"

# 후처리
image = self.image_processor.postprocess(image, output_type=output_type)
if padding_mask_crop is not None:
    image = [self.image_processor.apply_overlay(mask_image, original_image, i, crops_coords) for i in image]
```

`apply_overlay`(`image_processor.py:788-828`):

```python
init_image_masked = PIL.Image.new("RGBa", (width, height))
init_image_masked.paste(init_image.convert("RGBA").convert("RGBa"),
                        mask=ImageOps.invert(mask.convert("L")))
init_image_masked = init_image_masked.convert("RGBA")
if crop_coords is not None:
    x, y, x2, y2 = crop_coords
    base_image = PIL.Image.new("RGBA", (width, height))
    image = self.resize(image, height=y2-y, width=x2-x, resize_mode="crop")
    base_image.paste(image, (x, y))
    image = base_image.convert("RGB")
```

→ 마스크 밖은 **원본 픽셀 그대로** 복원된다. **VAE 왕복 열화조차 없다.**

`get_crop_region`(`image_processor.py:288`)은 *"Finds a rectangular region that contains all masked areas in an image, and expands region to match the aspect ratio of the original image; for example, if user drew mask in a 128x32 region, and the dimensions for processing are 512x512, the region will be expanded to 128x128."*

→ 작은 영역을 칠했을 때 **해상도까지 벌어준다**. 작은 영역 편집 품질에 결정적이다.

### 1-C. 제약 3가지 (소스 확인)

**제약 1 — `height`/`width` 인자가 무시된다.**

```python
# pipeline_qwenimage_edit_inpaint.py:784-789
image_size = image[0].size if isinstance(image, list) else image.size
calculated_width, calculated_height, _ = calculate_dimensions(1024 * 1024, image_size[0] / image_size[1])

# height and width are the same as the calculated height and width
height = calculated_height
width = calculated_width
```

출력은 항상 입력 종횡비의 1024² 면적 박스다. → **서버가 최종 리사이즈를 반드시 해야 한다.**

**제약 2 — 마스크가 0.5 임계로 이진화된다.** `mask_processor`의 `do_binarize=True`. 파이프라인 내부 페더링 없음 → 부드러운 경계는 서버가 만든다.

**제약 3 — 프롬프트 템플릿과 VL 조건 해상도가 2511 학습 형식과 다르다.**

```python
# edit_inpaint (구형): 템플릿에 vision 토큰이 하드코딩, "Picture N:" 접두 없음
self.prompt_template_encode = (
    "<|im_start|>system\n…<|im_end|>\n<|im_start|>user\n"
    "<|vision_start|><|image_pad|><|vision_end|>{}<|im_end|>\n<|im_start|>assistant\n")

# edit_plus (2511 학습 형식): 이미지 개수만큼 "Picture N:" 접두를 동적 생성
img_prompt_template = "Picture {}: <|vision_start|><|image_pad|><|vision_end|>"
```

또 VL 조건 이미지 해상도도 다르다:

```python
# edit_inpaint — 1024² 면적 그대로 VL에 전달
image = self.image_processor.resize(image, calculated_height, calculated_width)
original_image = image
prompt_image = image
...
prompt_embeds, prompt_embeds_mask = self.encode_prompt(image=prompt_image, prompt=prompt, ...)

# edit_plus — 384² 면적으로 축소해 VL에 전달
condition_width, condition_height = calculate_dimensions(CONDITION_IMAGE_SIZE, image_width / image_height)
condition_images.append(self.image_processor.resize(img, condition_height, condition_width))
```

→ **크래시는 없지만 품질 열화 가능. 미검증(B-1). 이게 최우선 실측 항목이다.**

### 1-D. 결론

마스크 편집·아웃페인팅은 **`QwenImageEditInpaintPipeline` + 2511 + `padding_mask_crop`** 을 1순위로 잡는다. 두 파이프라인은 **컴포넌트를 공유해 함께 상주시킬 수 있으므로 추가 VRAM이 0**이다(§D-1). 실측(B-1) 후 확정한다.

## 답 2 — 아웃페인팅 구체안

우리 입력은 `startOutpaintJob` → `composeContainFit`이 만든 것이다:

```js
// src/core/imageJobRunner.js
const r = containFitRect(elementW, elementH, img.naturalWidth, img.naturalHeight)
const canvas = document.createElement('canvas')
canvas.width = elementW; canvas.height = elementH
canvas.getContext('2d').drawImage(img, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))
resolve(canvas.toDataURL('image/png'))
```

캔버스는 초기화 상태(투명)이고 이미지를 contain-fit 위치에 그리므로 **레터박스/필러박스 영역의 알파가 0**이다.

### 마스크 방향

- Qwen: **흰(255) = 편집, 검(0) = 보존** (§A-4 docstring)
- 우리: **투명(알파 0) = 편집, 불투명 = 보존**
- → **알파를 반전하면 그대로 Qwen 극성이 된다.** `ImageChops.invert(alpha)`

### 정확한 절차

전문은 §E-4에 단계로 적었다. 요약하면:

1. RGBA로 열어 알파 추출 → `edit_mask = ImageChops.invert(alpha)`
2. **알파 평탄화(필수)** — RGBA 직접 입력은 깨진다(§A-5)
3. `QwenImageEditInpaintPipeline(image=평탄화된 RGB, mask_image=edit_mask, strength=1.0, padding_mask_crop=None)`
   - 아웃페인팅은 마스크가 이미 프레임 가장자리라 크롭이 무의미 → `padding_mask_crop`은 **쓰지 않는다**
4. 출력을 원본 크기로 리사이즈 (`height`/`width` 무시되므로 필수)
5. **서버 페더 합성 필요** — `padding_mask_crop=None`이면 `apply_overlay`가 호출되지 않아 latent 블렌딩만 남고, VAE 왕복 열화가 남는다

### 페더 권장값

캡처는 `captureElementRegion`이 `scale: 2`로 하므로 캡처 px = 요소 px × 2다.

| 용도 | 페더 (캡처 px) | 요소 px 환산 |
|---|---|---|
| 마스크 편집, `padding_mask_crop` 사용 | 0 (파이프라인이 처리) | — |
| 마스크 편집, `crop_pad=0`일 때 | 8–10 | 4–5 |
| 아웃페인팅 | 12–16 | 6–8 |

경험칙이며 **B-8에서 조정 대상**이다.

## 답 3 — 순수 T2I (`image=None`)

### 동작하지 않는다 (소스 확정)

`pipeline_qwenimage_edit_plus.py:645`는 `__call__` 본문의 **첫 실행 문장**이다:

```python
"""
...docstring...
"""
image_size = image[-1].size if isinstance(image, list) else image.size
```

`None` 가드가 없다. → `AttributeError: 'NoneType' object has no attribute 'size'` **즉시 예외.** 깨진 출력이 아니라 예외다.

타입 힌트가 `PipelineImageInput | None`인 이유는 **하위 헬퍼가 None을 처리하기 때문**이지 `__call__` 진입이 허용된다는 뜻이 아니다:

```python
# :244  _get_qwen_prompt_embeds
elif image is not None:
    base_img_prompt = img_prompt_template.format(1)
else:
    base_img_prompt = ""

# :690  전처리
if image is not None and not (isinstance(image, torch.Tensor) and image.size(1) == self.latent_channels):
```

→ **2511 단독으로는 정상 T2I 경로가 없다.**

### 대안: `Qwen/Qwen-Image-2512` 병행 적재

TE·VAE가 비트 단위로 동일하므로(§A-6) **증분은 트랜스포머 하나뿐**:

| 양자화 | 증분 VRAM | 증분 디스크 |
|---|---|---|
| bf16 | +40.9 GB | +40.9 GB |
| FP8 | +20.5 GB | +20.5 GB |
| NF4 | +11 GB (산술 추정) | (bf16 원본 필요) |

⚠️ **절대 VRAM 피크는 미확인(B-5).** 위 숫자는 전부 가중치 파일 크기 합산이며 활성화 메모리는 포함하지 않는다.

### 세 번째 선택지 (미검증)

단색/흰 캔버스를 입력으로 넣어 T2I를 흉내내는 방법. **공식 근거 전무(B-2). 검증 전 채택 금지.**

흥미로운 신호 하나: `_get_qwen_prompt_embeds`가 `image=None`을 `base_img_prompt=""`로 정상 처리한다(위 코드). 학습 시 이미지 없는 케이스가 있었을 가능성은 있으나 **추론일 뿐**이며 사실로 쓰면 안 된다.

---

# B. 미확인 / GPU 실측 필요

본문의 어떤 확정 서술도 이 절의 항목에 의존하지 않는다.

| ID | 항목 | 왜 미확인인가 |
|---|---|---|
| **B-1** | `QwenImageEditInpaintPipeline` + 2511의 **출력 품질** | 로드·픽셀보존은 확정(§답1)이나, 프롬프트 템플릿(`Picture N:` 유무)과 VL 조건 해상도(384² vs 1024²)가 2511 학습 형식과 다르다. 열화 정도는 실행해야 안다. **최우선.** |
| **B-2** | 단색 캔버스 T2I 흉내의 품질 | 공식 근거 전무. `image=None`이 예외인 것은 확정이지만, 흰 캔버스 우회의 결과물 품질은 아무 데도 문서화돼 있지 않다. |
| **B-3** | lightx2v fp8-scaled 단일파일 `from_single_file` 로드 | `single_file_model.py:192`에 항등 매핑 엔트리는 있으나 ComfyUI scaled 포맷의 `scale_weight` 텐서 처리 미확인 |
| **B-4** | GGUF(`GGUFQuantizationConfig` + `from_single_file`) 로드 | diffusers GGUF 지원 모델 목록에 QwenImage가 명시돼 있는지 확인 못 함 |
| **B-5** | **실측 피크 VRAM** | 본 문서 §F-1 표는 전부 가중치 파일 크기 산술합. 활성화 메모리·CUDA 컨텍스트·오프로드 버퍼 미포함 |
| **B-6** | **실측 추론 속도** | Qwen 공식·diffusers 문서 어디에도 2511의 초당 수치가 없다. 개인 블로그 수치는 인용하지 않았다 |
| **B-7** | Lightning 4스텝 LoRA의 **텍스트 렌더링** 품질 | 슬라이드 이미지엔 글자가 자주 들어간다. 스텝 증류가 이를 얼마나 해치는지 미측정 |
| **B-8** | 아웃페인팅 알파 평탄화 배경색(edge-replicate / 중립회색 / 흰색)과 페더 폭 | 실험 필요 |
| **B-9** | 안전 필터 | Qwen에 Ideogram식 회색카드 메커니즘은 문서화된 바 없음(사실상 없음). 단 "없다"는 적극 근거도 없으므로 `X-Safety-Blocked`는 상수 `false`로 보내 프론트 호환만 유지 |
| **B-10** | `padding_mask_crop` 최적값 | diffusers 문서에 권장값 없음. 32 / 64 / 128 비교 필요 |
| **B-11** | LoRA 어댑터가 컴포넌트 공유 파이프라인 양쪽에 함께 적용되는지 | 트랜스포머를 공유하므로 그럴 것으로 보이나 `set_adapters`가 파이프라인 단위 상태를 갖는지 확인 필요 |

---

# C. 서버 API 설계

**원칙: `src/core/ImagenBackendClient.js`를 깨지 않는다.** `probeImagenBackend` / `checkImagenBackend`가 읽는 `{ok, ready, device, build, presets}`를 그대로 두고 필드만 추가한다.

현재 프론트가 읽는 필드(`ImagenBackendClient.js`):

```js
const j = await res.json()
return {
  ok: true,
  ready: j.ready === true,
  device: j.device || null,
  build: j.build || null,
  presets: Array.isArray(j.presets) ? j.presets : null,
}
```

## C-1. `GET /api/health`

```jsonc
{
  "status": "ok",
  "build": "2026-09-05.1-qwen-edit-2511-nf4",
  "device": "cuda",
  "model": "Qwen/Qwen-Image-Edit-2511",
  "presets": ["QIE_FAST_4", "QIE_BALANCED_8", "QIE_QUALITY_40"],
  "ready": true,

  // ── 이하 신규. 구 클라이언트는 무시한다 ──
  "models":       { "edit": "Qwen/Qwen-Image-Edit-2511", "t2i": null },
  "capabilities": { "edit": true, "mask": true, "outpaint": true, "t2i": false },
  "quantization": "bnb-nf4",
  "presetDetail": {
    "QIE_FAST_4":     { "steps": 4,  "trueCfgScale": 1.0, "lora": "lightning-4step" },
    "QIE_BALANCED_8": { "steps": 8,  "trueCfgScale": 1.0, "lora": "lightning-8step" },
    "QIE_QUALITY_40": { "steps": 40, "trueCfgScale": 4.0, "lora": null }
  }
}
```

### 프리셋 매핑 제안

프론트 `startTextToImageJob`이 `preset: 'V4_TURBO_12'`를 **하드코딩**하고 있다:

```js
const out = await generateLayoutImage(caption, { ...size, preset: 'V4_TURBO_12', signal: ctrl.signal })
```

→ **서버가 구 이름을 별칭으로 받아야 한다.**

| 구 이름 (Ideogram 실측) | 신규 | Qwen 설정 |
|---|---|---|
| `V4_TURBO_12` (~28 s) | `QIE_FAST_4` | Lightning 4step LoRA + §A-8 스케줄러, `num_inference_steps=4`, `true_cfg_scale=1.0` |
| `V4_DEFAULT_20` (~50 s) | `QIE_BALANCED_8` | Lightning 8step LoRA + §A-8 스케줄러, `steps=8`, `true_cfg_scale=1.0` |
| `V4_QUALITY_48` (~127 s) | `QIE_QUALITY_40` | LoRA off + repo 기본 스케줄러, `steps=40`, `true_cfg_scale=4.0`, `negative_prompt=" "` |

`presets` 배열에는 신규 이름만 노출하고, 별칭 테이블은 서버 내부에서 조용히 해석한다. 미지의 값은 기존처럼 `DEFAULT_PRESET`으로 폴백.

**속도 기대치는 미확정(B-6).** 이론 forward 횟수는 4 / 8 / 80이다(§A-8).

## C-2. `POST /api/generate` (T2I) — 스키마 유지

요청 JSON `{ caption?, prompt?, width, height, preset, seed }`, 응답 `image/png` + `X-Inference-Ms` + `X-Safety-Blocked`. **그대로 둔다.**

다만 두 가지를 서버가 흡수해야 한다.

**(1) `caption`(Ideogram 4 JSON, bbox 0–1000)은 Qwen이 못 읽는다.**

현재 프론트는 `generateIdeogramCaption`으로 이런 구조를 만든다:

```js
{
  "high_level_description": "...",
  "compositional_deconstruction": {
    "background": "...",
    "elements": [{ "type": "obj", "bbox": [300, 350, 750, 650], "desc": "..." }]
  }
}
```

서버는 dict를 받으면 JSON 직렬화 대신 **평문 평탄화**해야 한다(`high_level_description` + `background` + 각 `elements[].desc`를 문장으로 연결). 근본 해결은 프론트가 `generateIdeogramCaption` → `generateImagePrompt`(평문)로 갈아타는 것이며, 이는 별도 작업으로 분리한다.

**(2) T2I 백엔드 미탑재면 501** + `{"error": "이 서버는 텍스트→이미지를 지원하지 않습니다(IMGEN_T2I_REPO 미설정)."}`.
프론트는 이미 `res.json().error`를 읽어 표시한다.

## C-3. `POST /api/edit` (신규) — `multipart/form-data`

이미지가 수 MB이고(캡처 `scale:2`), 프론트에 이미 Blob이 있으며, OpenAI `images/edits`와 모양이 같아 프론트 변경이 최소다. base64 JSON은 33% 팽창하므로 피한다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `image` | file (PNG/JPEG) | ✓ | 입력 이미지. RGBA면 서버가 평탄화 |
| `prompt` | text | ✓ | 편집 지시 |
| `mask` | file (PNG) | — | **투명 = 편집, 불투명 = 보존** (`buildMask` 출력 그대로) |
| `mode` | text | — | `edit`(기본) \| `outpaint` \| `img2img` |
| `width` / `height` | int | — | 목표 출력 px. 없으면 입력 크기 |
| `preset` | text | — | C-1 프리셋(구 이름 별칭 허용) |
| `seed` | int | — | 기본 0 |
| `negative_prompt` | text | — | 기본 `" "` |
| `strength` | float | — | `edit` 기본 0.85 / `outpaint` 1.0 / `img2img` 해당없음 |
| `crop_pad` | int | — | `padding_mask_crop` 값. 기본 `32`, `0`이면 비활성 |
| `feather` | int | — | 서버 합성 페더 px. `edit` 8 / `outpaint` 14 |

### `mode`가 필요한 이유 — 세 작업의 마스크 의미가 다르다

| mode | 프론트 작업 | 파이프라인 | 마스크 | 합성 |
|---|---|---|---|---|
| `edit` | 2. 설명으로 편집 | mask 있으면 **Inpaint**(`padding_mask_crop=crop_pad`), 없으면 **EditPlus** | 사용자가 칠한 것 | 파이프라인이 처리(`apply_overlay`) |
| `outpaint` | 3. 여백까지 그림 채우기 | **Inpaint** (`padding_mask_crop=None`) | 입력 RGBA의 **알파 0 영역을 자동 승격** — `mask` 파일 불필요 | **서버가 페더 합성** |
| `img2img` | 4. 인포그래픽 | **EditPlus** | 무시 | 없음(전체 재생성이 의도) |

응답: `image/png` + `X-Inference-Ms` + `X-Safety-Blocked: false`.

## C-4. 프론트 대응 (이 스펙의 범위 밖, 별도 작업)

1. `ImagenBackendClient.js`에 `editLayoutImage(blob, prompt, {mask, mode, width, height, preset, seed, strength, signal})` 추가.
2. `imageJobRunner.startCaptureEditJob`이 `localStorage['ai-image-backend']` 값에 따라 `editImage`(OpenAI) / `editLayoutImage`(로컬)를 분기.
3. `startImageEditJob` / `startOutpaintJob` / `startInfographicJob`의 `if (!hasApiKey()) return null` 하드 게이트를 백엔드별로 갈라야 한다.
4. `imagenDockerRunCommand({hfToken})`의 HF 토큰 안내 제거 — Apache-2.0, `gated: false`(§A-1).
5. `startTextToImageJob`의 `generateIdeogramCaption` → 평문 프롬프트 전환(§C-2).

---

# D. `generator.py` 함수 시그니처 초안

실제 코드가 아니라 **시그니처 + 각 단계 설명**이다.

## D-0. 모듈 상수 / 환경변수

```python
BUILD_VERSION  = "2026-09-05.1-qwen-edit-2511-<quant>"
EDIT_REPO      = env("IMGEN_EDIT_REPO", "Qwen/Qwen-Image-Edit-2511")
T2I_REPO       = env("IMGEN_T2I_REPO",  "")        # 빈 값 = T2I 비활성(기본)
QUANT          = env("IMGEN_QUANT",     "nf4")     # nf4 | fp8 | bf16 | gguf
LORA_REPO      = env("IMGEN_LORA_REPO", "lightx2v/Qwen-Image-Edit-2511-Lightning")
DEVICE         = env("IMGEN_DEVICE",    "cuda")
OFFLOAD        = env("IMGEN_OFFLOAD",   "model")   # none | model | sequential
DEFAULT_PRESET = "QIE_FAST_4"

PRESET_ALIASES = {
    "V4_TURBO_12":   "QIE_FAST_4",
    "V4_DEFAULT_20": "QIE_BALANCED_8",
    "V4_QUALITY_48": "QIE_QUALITY_40",
}

PRESETS = {
    "QIE_FAST_4":     Preset(steps=4,  true_cfg_scale=1.0, adapter="fast4"),
    "QIE_BALANCED_8": Preset(steps=8,  true_cfg_scale=1.0, adapter="fast8"),
    "QIE_QUALITY_40": Preset(steps=40, true_cfg_scale=4.0, adapter=None),
}

_edit = None      # QwenImageEditPlusPipeline
_inpaint = None   # QwenImageEditInpaintPipeline — 컴포넌트 공유
_t2i = None       # QwenImagePipeline — 옵션
_lock = threading.Lock()       # 로드 1회 직렬화
_gen_lock = threading.Lock()   # 추론 직렬화(단일 GPU) — 기존 코드와 동일 패턴 유지
```

## D-1. 모델 로드 (프로세스당 1회)

```python
def ensure_loaded() -> None
```

1. `_lock` 아래에서 이중 확인(기존 `ensure_loaded` 패턴 그대로).

2. 편집 파이프라인 로드:
   ```python
   _edit = QwenImageEditPlusPipeline.from_pretrained(
       EDIT_REPO,
       torch_dtype=torch.bfloat16,
       quantization_config=<QUANT별 PipelineQuantizationConfig>)
   ```

3. **인페인트 파이프라인을 컴포넌트 재사용으로 생성 — 추가 VRAM 0.**
   §답1-A에서 `__init__` 6개 컴포넌트가 완전히 동일함을 확인했다.
   ```python
   _inpaint = QwenImageEditInpaintPipeline(
       scheduler=_edit.scheduler,
       vae=_edit.vae,
       text_encoder=_edit.text_encoder,
       tokenizer=_edit.tokenizer,
       processor=_edit.processor,
       transformer=_edit.transformer,
   )
   ```
   ⚠️ **`from_pretrained`를 두 번 부르지 말 것** — 가중치가 두 벌 올라간다.

4. Lightning LoRA를 **fuse 없이** 두 어댑터로 적재:
   ```python
   _edit.load_lora_weights(LORA_REPO,
       weight_name="Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
       adapter_name="fast4")
   _edit.load_lora_weights(LORA_REPO,
       weight_name="Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors",
       adapter_name="fast8")
   ```
   트랜스포머를 공유하므로 `_inpaint`에도 함께 적용될 것으로 보이나 **B-11에서 확인 필요.**

5. 스케줄러 두 개를 보관:
   ```python
   _sched_base = _edit.scheduler                                    # repo 기본
   _sched_lightning = FlowMatchEulerDiscreteScheduler.from_config(  # §A-8
       {..., "base_shift": math.log(3), "max_shift": math.log(3), "shift_terminal": None, ...})
   ```

6. 오프로드 — `"model"` → `enable_model_cpu_offload()`, `"sequential"` → `enable_sequential_cpu_offload()`, `"none"` → `.to(DEVICE)`.
   ⚠️ **`enable_*_cpu_offload()`와 `.to("cuda")`를 함께 쓰면 안 된다.**

7. `T2I_REPO`가 설정돼 있으면 컴포넌트 공유로 추가 (§A-6 SHA256 근거):
   ```python
   _t2i = QwenImagePipeline.from_pretrained(
       T2I_REPO,
       text_encoder=_edit.text_encoder,
       tokenizer=_edit.tokenizer,
       vae=_edit.vae,
       torch_dtype=torch.bfloat16,
       quantization_config=...)
   ```
   증분 = 트랜스포머 1개.

## D-2. 프리셋 적용

```python
def _apply_preset(pipe, name: str) -> Preset
```

- `PRESET_ALIASES`로 정규화 → `PRESETS`에 없으면 `DEFAULT_PRESET`.
- LoRA 필요: `pipe.scheduler = _sched_lightning`; `pipe.set_adapters([p.adapter], [1.0])`
- LoRA 불필요: `pipe.scheduler = _sched_base`; `pipe.disable_lora()`
- ⚠️ **스케줄러는 파이프라인별로 따로 세팅해야 한다** — `_edit`와 `_inpaint`가 각자 `self.scheduler`를 갖는다.
- 반환 `Preset(steps, true_cfg_scale, adapter)`

## D-3. 생성 (T2I)

```python
def generate(src: dict | str, width: int = 1024, height: int = 1024,
             preset: str = DEFAULT_PRESET, seed: int = 0) -> tuple[bytes, int, bool]
```

1. `src`가 dict면 `_flatten_caption(src)`로 평문화. 문자열이면 그대로.
2. `_t2i is None` → `NotImplementedError` (서버가 501로 변환).
3. `width`/`height`를 16배수 반올림(`_round16`).
4. `_gen_lock` + `torch.inference_mode()`:
   ```python
   img = _t2i(prompt=text,
              negative_prompt=T2I_NEGATIVE,        # §A-9 중국어 네거티브
              width=w, height=h,
              num_inference_steps=p.steps,
              true_cfg_scale=p.true_cfg_scale,
              generator=torch.Generator(DEVICE).manual_seed(seed)).images[0]
   ```
   **`guidance_scale`은 넘기지 않는다** — `guidance_embeds: false`라 무시 + 경고(§A-2).
5. 요청 크기와 다르면 LANCZOS 리사이즈 → PNG. `(png, infer_ms, False)` 반환.
   세 번째 값 `blocked`는 항상 `False`(B-9) — 프론트 시그니처 호환용.

## D-4. 편집 — 핵심 함수

```python
def edit(image_bytes: bytes, prompt: str, *,
         mask_bytes: bytes | None = None,
         mode: str = "edit",                 # edit | outpaint | img2img
         width: int | None = None,
         height: int | None = None,
         preset: str = DEFAULT_PRESET,
         seed: int = 0,
         negative_prompt: str = " ",
         strength: float | None = None,
         crop_pad: int = 32,
         feather: int | None = None,
         ) -> tuple[bytes, int]
```

### 단계

**1. 입력 로드 + 알파 평탄화**
```python
src = Image.open(BytesIO(image_bytes))
src_rgb, src_alpha = _flatten_rgba(src, mode)
```
RGBA를 그대로 넘기면 깨진다(§A-5).

**2. 편집 마스크(`L`, 흰=편집) 결정**
```python
if mode == "outpaint":
    edit_mask = ImageChops.invert(src_alpha) if src_alpha else None
elif mask_bytes:
    edit_mask = _openai_mask_to_qwen(mask_bytes, src.size)
else:
    edit_mask = None
```

**3. 프리셋 적용** — 사용할 파이프라인을 정한 뒤 그 파이프라인에 `_apply_preset`.

**4. 파이프라인 분기**

`edit_mask is None` 또는 `mode == "img2img"` → **EditPlus**:
```python
p = _apply_preset(_edit, preset)
out = _edit(image=[src_rgb],
            prompt=prompt,
            negative_prompt=negative_prompt,
            height=_round16(height or src.height),
            width=_round16(width or src.width),
            num_inference_steps=p.steps,
            true_cfg_scale=p.true_cfg_scale,
            generator=g).images[0]
```
`height`/`width`가 유효하므로 원하는 종횡비로 바로 뽑힌다(§A-2).

`edit_mask is not None` → **EditInpaint**:
```python
p = _apply_preset(_inpaint, preset)
out = _inpaint(image=src_rgb,
               mask_image=edit_mask,
               prompt=prompt,
               negative_prompt=negative_prompt,
               strength=strength if strength is not None else (1.0 if mode == "outpaint" else 0.85),
               num_inference_steps=p.steps,
               true_cfg_scale=p.true_cfg_scale,
               padding_mask_crop=(crop_pad or None) if mode == "edit" else None,
               generator=g).images[0]
```
⚠️ 출력 크기는 인자와 무관하게 1024² 면적이다(§답1 제약1).

**5. 직렬 실행** — `_gen_lock` + `torch.inference_mode()`. 단일 GPU에서 동시 추론은 OOM/충돌을 낸다(기존 `generator.py` 주석과 동일한 이유).

**6. 원본 좌표계로 리사이즈**
```python
out = out.resize(src.size, Image.LANCZOS)
```

**7. 서버 페더 합성 — `padding_mask_crop`을 쓰지 않은 마스크 경로만**
```python
used_overlay = (mode == "edit" and edit_mask is not None and crop_pad)
if edit_mask is not None and not used_overlay:
    out = _composite_preserve(src_rgb, out, edit_mask, feather or _default_feather(mode))
```
⚠️ `padding_mask_crop`을 쓴 경로는 파이프라인의 `apply_overlay`가 이미 보존 합성을 끝냈다. **중복 합성 금지** — 경계가 두 번 이진화되어 오히려 각진다.

**8. 최종 리사이즈 + PNG 인코딩** → `(png, infer_ms)`

## D-5. 보조 함수

```python
def _flatten_rgba(img: Image, mode: str) -> tuple[Image, Image | None]
    """RGBA → (3채널 RGB, 알파 L 또는 None). mode='outpaint'면 edge-replicate 채움."""

def _openai_mask_to_qwen(mask_png: bytes, size: tuple[int, int]) -> Image | None
    """투명=편집 PNG → L 마스크(흰=편집). 알파 채널 없으면 None + 경고."""

def _composite_preserve(orig: Image, gen: Image, edit_mask: Image, feather: int) -> Image
    """마스크 밖 원본 픽셀 복원. 경계는 가우시안 블러로 페더."""

def _edge_replicate_fill(rgb: Image, alpha: Image, radius: int = 24) -> Image
    """투명 영역을 가장자리 픽셀 확장으로 채운다(아웃페인팅 입력용)."""

def _flatten_caption(caption: dict) -> str
    """Ideogram 4 JSON 캡션 → 평문. high_level_description + background + elements[].desc"""

def _round16(v: int) -> int
def get_device() -> str
def is_ready() -> bool
def list_presets() -> list[str]
def capabilities() -> dict
def warmup() -> None
    """로드 + 작은 더미 편집 1회(예: 256×256 단색 + 'make it blue')로 콜드스타트 제거."""
```

## D-6. 삭제할 것

기존 `generator.py`의 다음 항목은 **전부 제거**한다 (Ideogram 전용 회색카드 대응, B-9):

- `SAFETY_STD_THRESHOLD`, `SAFETY_MAX_ATTEMPTS`
- `_looks_blocked()`
- `generate()` 안의 시드 변경 재시도 루프
- `_serialize_caption()` (JSON 직렬화 → 평문 평탄화로 대체)

`X-Safety-Blocked` 응답 헤더는 상수 `"false"`로 유지해 프론트의 아래 코드가 계속 동작하게 한다:

```js
if (res.headers.get('X-Safety-Blocked') === 'true') { throw new Error(...) }
```

---

# E. 마스크 / 알파 변환 로직

## E-1. 우리 입력의 실제 형식 (코드 확인)

### 마스크 — `src/components/MaskBrushOverlay.jsx:117-138`

```js
buildMask: (capW, capH) => {
  const cr = contentRectRef.current
  if (!hasEditableStrokes(strokesRef.current, cr)) return null
  const off = document.createElement('canvas')
  off.width = capW; off.height = capH
  const ctx = off.getContext('2d')
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, capW, capH)   // 불투명 = 보존
  const sx = capW / (element.width || 1), sy = capH / (element.height || 1)
  for (const s of strokesRef.current) {
    ctx.globalCompositeOperation = s.tool === 'erase' ? 'source-over' : 'destination-out'
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = Math.max(1, s.size * sx)
    strokePathXY(ctx, s.pts, sx, sy)
  }
  if (cr) {   // contain 여백 클리핑: 표시 사각형 밖은 다시 불투명(보존)
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000000'
    fillOutside(ctx, { x: cr.x*sx, y: cr.y*sy, w: cr.w*sx, h: cr.h*sy }, capW, capH)
  }
  return off.toDataURL('image/png')
}
```

정리:
- **RGB는 전부 (0,0,0)이고 알파만 의미가 있다.**
- **알파 0(투명) = 편집, 알파 255(불투명) = 보존.** OpenAI `images/edits` 규약과 동일.
- 크기는 `startImageEditJob`이 `imageSize(cap)`로 얻은 **캡처 픽셀 크기**. `captureElementRegion`은 `scale: 2` 캡처(`exportAsImage(canvasNode, { format:'png', scale: 2, offscreen: true })`)이므로 요소 px의 2배다.

### 아웃페인팅 입력 — `composeContainFit`

투명 캔버스에 contain-fit으로 그리므로 **레터박스/필러박스 영역의 알파가 0**이다.

### 현재 OpenAI 계약 — `src/core/OpenAIClient.js:393-436`

```js
const maskBlob = mask ? dataUrlToBlob(mask) : null // 있으면 편집 영역 마스크(투명=편집)
...
if (maskBlob) form.append('mask', maskBlob, 'mask.png') // 부분 편집(인페인팅)
```

## E-2. OpenAI 마스크 → Qwen 마스크 (`_openai_mask_to_qwen`)

```
1. m = Image.open(BytesIO(mask_png))

2. if "A" not in m.getbands():
       경고 로그 + None 반환
   ← 알파가 없으면 전부 "보존"으로 해석되어 아무것도 편집되지 않는다.
     조용히 실패하는 대신 명시적으로 마스크를 버리고 전체 편집으로 가는 편이 낫다.

3. m = m.convert("RGBA")
   a = m.getchannel("A")                       # 0 = 편집, 255 = 보존

4. edit_mask = ImageChops.invert(a)            # 255 = 편집, 0 = 보존  ← Qwen 극성

5. edit_mask = edit_mask.resize(src.size, Image.NEAREST)
   ← 캡처 크기(요소 px × 2) ≠ 원본 크기일 때 보정. NEAREST로 이진성 유지.

6. edit_mask = edit_mask.point(lambda v: 255 if v >= 128 else 0)
   ← 명시적 이진화. 파이프라인의 mask_processor가 do_binarize=True로 0.5 임계
     이진화하므로 미리 맞춰 두면 결과가 예측 가능해진다.

7. return edit_mask     # PIL "L" 모드
```

이 `edit_mask`를 `mask_image`로 그대로 넘긴다 — docstring *"White pixels in the mask are repainted while black pixels are preserved."*

## E-3. 마스크 편집(`mode="edit"`) 권장 파라미터

```python
strength          = 0.85    # 0.6(기본)은 지시 반영이 약하다. 1.0은 원본 무시 위험
padding_mask_crop = 32      # 작은 영역을 칠했을 때 해상도를 벌어줌 + apply_overlay로 픽셀 보존
num_inference_steps, true_cfg_scale = 프리셋에서
negative_prompt   = " "
```

`padding_mask_crop`을 쓰면 **서버 합성이 불필요**하다 — 파이프라인이 `apply_overlay`로 원본 픽셀을 복원한다(§답1-B(3)). 최종 리사이즈만 하면 된다.

⚠️ `padding_mask_crop`을 쓸 때 `check_inputs`가 `image`/`mask_image`를 **PIL로, `output_type="pil"`로** 강제한다:

```python
if padding_mask_crop is not None:
    if not isinstance(image, PIL.Image.Image):
        raise ValueError(f"The image should be a PIL image when inpainting mask crop, but is of type {type(image)}.")
    if not isinstance(mask_image, PIL.Image.Image):
        raise ValueError(f"The mask image should be a PIL image when inpainting mask crop, but is of type ...")
    if output_type != "pil":
        raise ValueError(f"The output type should be PIL when inpainting mask crop, but is {output_type}.")
```

텐서 입력 불가. 우리는 PIL만 쓰므로 문제없다.

## E-4. 아웃페인팅(`mode="outpaint"`) 정확한 절차 — 전문

```
1. src = Image.open(BytesIO(image_bytes)).convert("RGBA")

2. alpha = src.getchannel("A")

3. edit_mask = ImageChops.invert(alpha)
   → 투명 여백(알파 0) = 흰(255) = 편집
   → 원본 이미지 영역(알파 255) = 검(0) = 보존
   ※ 방향이 §A-4 docstring과 정확히 맞는다.

4. 알파 평탄화 (필수)
   ── 이유: VaeImageProcessor는 do_convert_rgb=False이고 pil_to_numpy가
      np.array(image)를 그대로 쓴다. RGBA를 넘기면 4채널이 되어 VAE에서 깨진다.

   권장 a) edge-replicate
        expanded = src.convert("RGB").filter(ImageFilter.GaussianBlur(radius=24))
        # 또는 알파 경계를 반복 팽창시켜 여백을 원본 가장자리 색으로 채움
        filled = Image.composite(src.convert("RGB"), expanded, alpha)
        → 순수 흰/검정보다 모델이 "여백"을 배경으로 오인할 확률이 낮다.

   폴백 b) 중립 회색
        bg = Image.new("RGB", src.size, (128, 128, 128))
        filled = Image.composite(src.convert("RGB"), bg, alpha)

   ⚠️ 흰색 평탄화는 피할 것 — 모델이 "흰 배경"으로 학습해 여백을 그대로
      흰색으로 둘 위험이 있다.
   ※ a/b의 실효 차이는 미검증(B-8). env 플래그로 둘 다 실험 가능하게 할 것.

5. 인페인트 호출
   out = _inpaint(
       image=filled,
       mask_image=edit_mask,
       prompt=OUTPAINT_PROMPT,           # 아래 참조
       negative_prompt=" ",
       strength=1.0,                     # 여백은 원본이 없으므로 전부 새로 그림
       padding_mask_crop=None,           # ← 마스크가 이미 프레임 가장자리라 크롭 무의미
       num_inference_steps=p.steps,
       true_cfg_scale=p.true_cfg_scale,
       generator=torch.Generator(DEVICE).manual_seed(seed),
   ).images[0]

6. out = out.resize(src.size, Image.LANCZOS)
   ← 파이프라인이 height/width를 무시하고 1024² 면적으로 뱉으므로 필수(§답1 제약1)

7. 서버 페더 합성
   ── padding_mask_crop=None이라 apply_overlay가 호출되지 않았다.
      latent 블렌딩만으로는 VAE 왕복 열화가 남으므로 직접 되붙인다.

   m = edit_mask.filter(ImageFilter.GaussianBlur(radius=feather))    # feather 기본 14
   result = Image.composite(out, src_rgb, m)
   # m=255 → out(생성), m=0 → src_rgb(원본), 중간값 → 알파 블렌딩

8. 요청된 정확한 width×height로 최종 리사이즈 → PNG
```

### 프롬프트

현재 `startOutpaintJob`의 문구는 이렇다:

```js
const p = 'Seamlessly fill the transparent letterbox/pillarbox areas by naturally extending the existing scene. Match the exact colors, lighting, textures, mood, and visual style of the original image. The result must look like the image was always this size — no visible seams or transitions.'
```

**"transparent"라는 표현이 문제다.** 4단계에서 우리가 이미 평탄화했으므로 모델은 투명을 보지 못한다. Qwen은 명령형 편집 모델이므로 다음 계열로 바꾸는 것을 권한다:

```
Extend the existing scene outward to fill the entire frame.
Keep the existing subject and composition unchanged.
Match the exact colors, lighting, textures, and visual style. No visible seams.
```

## E-5. 페더 권장값

캡처는 `scale: 2`이므로 캡처 px = 요소 px × 2다.

| 용도 | 페더 (캡처 px) | 요소 px 환산 |
|---|---|---|
| 마스크 편집, `padding_mask_crop` 사용 | 0 (파이프라인이 처리) | — |
| 마스크 편집, `crop_pad=0`일 때 | 8–10 | 4–5 |
| 아웃페인팅 | 12–16 | 6–8 |

경험칙이며 **B-8에서 조정 대상**이다.

## E-6. 남는 한계

- 인페인트 경로는 latent 블렌딩이라 **편집 영역 내부는 새 픽셀**이다. Qwen이 전역 색조를 바꾸면 경계에서 색이 튈 수 있다. `padding_mask_crop`을 쓰면 크롭 범위 밖이 원본 그대로라 이 문제가 크게 줄어든다.
- EditPlus 경로(마스크 없음 / `img2img`)는 **픽셀 보존이 아예 없다**(§A-3). 이건 4번 인포그래픽 작업의 의도와 맞으므로 그대로 둔다.
- 입력 이미지는 파이프라인 내부에서 1024² 면적으로 리사이즈되므로(§A-2(3)) **원본 해상도가 그보다 크면 정보가 손실된다.** 캡처가 `scale:2`라 큰 요소는 이 한계에 걸린다.

---

# F. 하드웨어 권고

## F-1. 양자화별 메모리 (⚠️ 산술 추정 — B-5)

**아래 수치는 전부 §A-6의 가중치 파일 크기 합산이며, 활성화 메모리·CUDA 컨텍스트·오프로드 버퍼를 포함하지 않는다. 실측이 아니다.**

| 구성 | 트랜스포머 | 텍스트 인코더 | 상주 합계 | 필요 GPU |
|---|---|---|---|---|
| bf16, 오프로드 없음 | 40.9 GB | 16.6 GB | ~57.7 GB + α | **80 GB** (A100/H100) |
| bf16 + `model_cpu_offload` | 40.9 | (필요 시만 상주) | ~41 GB + α | **48 GB** |
| FP8 e4m3fn + `model_cpu_offload` | 20.5 | — | ~21 GB + α | **32 GB** 권장 / 24 GB 빠듯 |
| **bnb NF4 + `model_cpu_offload`** | ~11 | ~5 (NF4) | ~11–16 GB | **24 GB** ✅ |
| GGUF Q4_K_M | 13.2 | ~8 (fp8 TE) | ~14–21 GB | **24 GB** |
| GGUF Q8_0 | 21.8 | ~8 | ~22–30 GB | **32 GB** |
| `sequential_cpu_offload` | 레이어 단위 | | 수 GB | 8–12 GB (매우 느림) |

`enable_model_cpu_offload()`는 모듈 단위로 통째 올렸다 내리므로 **트랜스포머 하나가 VRAM에 다 들어가야 한다.** bf16 트랜스포머가 40.9 GB이므로 40 GB 카드로는 부족하고 48 GB가 필요하다.

**시스템 RAM 64 GB 이상**(오프로드 대상이 CPU RAM에 상주), **디스크 ~60 GB**(bf16 HF 캐시).

## F-2. 권고

### 기본값: `IMGEN_QUANT=nf4` + `IMGEN_OFFLOAD=model`

이유:
1. 이번 교체의 목적이 소비자 GPU 지원이고, 24 GB에 확실히 들어가는 경로다.
2. bitsandbytes는 diffusers 네이티브(`PipelineQuantizationConfig`)라 커뮤니티 단일파일 포맷 호환 리스크(B-3 / B-4)가 없다.
3. Apache-2.0 원본 가중치만 쓴다 — 서드파티 체크포인트를 신뢰할 필요가 없다.

단점: 최초 다운로드 57.7 GB, 로드 시 양자화라 로드 시간 증가, 품질 열화 미측정.

대안으로 `ovedrive/Qwen-Image-Edit-2511-4bit`(사전 양자화된 diffusers 폴더)를 쓰면 다운로드가 줄지만 커뮤니티 체크포인트 신뢰 문제가 생긴다.

### 품질 우선(사내 GPU 48 GB+): `IMGEN_QUANT=bf16` + `IMGEN_OFFLOAD=model`

### T2I는 기본 비활성 (`IMGEN_T2I_REPO=""`)

켜면 트랜스포머 1개(NF4 ~11 GB / FP8 20.5 GB / bf16 40.9 GB)가 추가된다. 24 GB 카드에서는 동시 상주가 어렵다. **48 GB 이상에서만 권장.**

### 인페인트 파이프라인 추가 비용은 0

컴포넌트 재사용(§D-1.3). 두 파이프라인을 모두 상주시켜 런타임에 고를 수 있게 한다.

### 프리셋 기본값은 Lightning 4스텝

이론 forward가 기본 대비 20배 적다(§A-8). 체감 지연이 Ideogram TURBO(28 s)보다 크게 줄 가능성이 높다. **절대값은 B-6.**

## F-3. Dockerfile 변경점

| 지금 | 바뀌어야 할 것 |
|---|---|
| `pip install "ideogram-4 @ git+https://github.com/ideogram-oss/ideogram4"` | **제거.** → `pip install git+https://github.com/huggingface/diffusers` (2511 EditPlus + `zero_cond_t`는 최신 main 필요 — 모델카드가 명시적으로 git 설치를 지시), `transformers`, `accelerate`, `safetensors`, **`peft`**(LoRA 필수), `bitsandbytes`, `sentencepiece` |
| torch가 ideogram-4에 딸려옴 | `torch`를 **명시적으로** cu12x 인덱스에서 설치 (`--index-url https://download.pytorch.org/whl/cu128`) |
| 주석 `⚠️ 추론 피크 VRAM ~32GB → 40GB급 이상 NVIDIA GPU 필요` | `NF4 24 GB / FP8 32 GB / bf16 48 GB` (전부 추정치임을 명시) |
| 주석 `⚠️ 게이트·비상업 라이선스 모델 → HF_TOKEN 필요` | **삭제.** Apache-2.0, `gated: false` |
| `-e HF_TOKEN=…` (README / `build-and-push.sh` / 프론트 `imagenDockerRunCommand`) | 불필요 (선택 유지 가능하나 안내 문구는 제거) |
| HF 캐시 볼륨 안내 `~20GB 재다운로드 방지` | **`~60GB`** 로 정정 |
| `ENV HF_HOME=/app/.hf-cache` | 유지 |
| — | 신규: `ENV IMGEN_QUANT=nf4 IMGEN_OFFLOAD=model IMGEN_T2I_REPO=""` |
| `requirements.txt`: `fastapi` / `uvicorn` / `pillow` | + **`python-multipart`** (`POST /api/edit` 멀티파트 파싱에 필수) |
| `IMGEN_WEIGHTS_REPO` (기본 `ideogram-ai/ideogram-4-fp8`) | `IMGEN_EDIT_REPO` (기본 `Qwen/Qwen-Image-Edit-2511`)로 개명 |
| `IMGEN_WARM_PRESET` (기본 `V4_TURBO_12`) | 기본 `QIE_FAST_4`로 변경 |

`--gpus all`, 포트 8323, CORS/PNA 미들웨어, `_gen_lock` 직렬화는 **그대로 둔다.**

`build-and-push.sh`의 이미지 이름(`dilly97/float-imgen`)과 amd64 전용 빌드도 그대로 유효하다.

---

# G. 리스크와 미결 결정

## G-1. 분기점 — T2I (1번 작업)

**확정: `EditPlus(image=None)`는 `AttributeError`.** 2511 단독으로 정상 T2I 경로가 없다(§답3).

| 안 | 내용 | 비용 | 리스크 |
|---|---|---|---|
| **G-1a (권장 기본)** | 서버 T2I 미지원(`capabilities.t2i=false`). 1번 작업은 OpenAI 백엔드로 남기거나, **텍스트 박스를 캡처해 입력 이미지로 주고 "이 텍스트 박스를 삽화로 바꿔라"는 편집 지시**로 재구성 | 0 | 프론트 UX 변경 필요. 후자는 미검증이지만 2511의 본령(편집)에 부합한다 |
| **G-1b (env 플래그)** | `IMGEN_T2I_REPO=Qwen/Qwen-Image-2512` 병행 적재. TE·VAE 공유(SHA256 확인)로 증분은 트랜스포머 1개 | +11 GB(NF4) / +20.5 GB(FP8) / +40.9 GB(bf16) VRAM, +41 GB 디스크 | 24 GB 카드에선 사실상 불가. 48 GB+ 배포 전용 |
| **G-1c (실험)** | 흰/회색 단색 캔버스를 EditPlus에 넣어 T2I 흉내 | 0 | **공식 근거 전무(B-2). 검증 전 채택 금지** |

**권고: G-1a를 기본으로, G-1b를 env 플래그로 제공.**

## G-2. 그 외 미결 결정

1. **인페인트 파이프라인 채택 여부.** §답1로 "로드 가능 + 픽셀 보존"은 확정됐으나 **2511 가중치에서의 출력 품질(B-1)** 이 미검증이다. 컴포넌트를 공유해 두 파이프라인을 모두 상주시키고(추가 VRAM 0) 런타임에 고를 수 있게 만든 뒤 실측으로 확정하는 설계를 권한다.
   미달 시 대안:
   - (i) EditPlus + 서버 합성 — §E-4 방식을 마스크 편집에도 적용. 확실하지만 픽셀 보존이 페더 합성 수준에 그친다.
   - (ii) EditPlus를 서브클래싱해 latent 블렌딩 한 줄(`latents = (1-m)*init_latents_proper + m*latents`)만 이식. 2511의 올바른 조건화(384² 조건, `Picture N:` 템플릿)를 유지하면서 픽셀 보존까지 얻는 이론적 최적해지만, 커스텀 파이프라인 유지보수 부담이 생긴다. EditPlus는 img2img 초기화가 없으므로 `prepare_latents`도 함께 손봐야 한다.
2. **LoRA 어댑터가 두 파이프라인에 함께 적용되는지(B-11).** 트랜스포머를 공유하므로 그럴 것으로 보이나 `set_adapters`가 파이프라인 단위 상태를 갖는지 확인 필요. **스케줄러는 확실히 파이프라인별로 따로 세팅해야 한다.**
3. **양자화 최종 선택.** NF4 / FP8 / GGUF 품질·속도 실측 후(B-3, B-4, B-7).
4. **Lightning 기본 적용 여부.** 슬라이드엔 글자가 자주 들어가는데 스텝 증류가 텍스트 렌더링을 얼마나 해치는지 미측정(B-7). 프리셋으로 노출해 사용자가 고르게 하는 지금 설계가 헤지다.
5. **캡션 계약 정리.** `generateIdeogramCaption`(bbox JSON)은 Qwen에 무의미하다. 서버 평탄화는 임시방편이고 프론트 전환이 근본 해결이다.
6. **프론트 하드 게이트 완화.** `hasApiKey()` 조건을 백엔드별로 분기해야 로컬 편집이 쓰인다.
7. **`X-Safety-Blocked` 헤더 유지 여부.** Qwen엔 회색카드 메커니즘이 없으므로 상수 `false`. 프론트 호환만을 위해 남긴다.

## G-3. GPU 실측 체크리스트

**GPU 머신에서 이것만 돌려보면 위 미결 결정이 전부 확정된다.**

### 1순위 — 이게 안 되면 설계가 바뀐다

- [ ] **B-1: `QwenImageEditInpaintPipeline.from_pretrained("Qwen/Qwen-Image-Edit-2511")` 로드 성공 확인** (예외 없이 뜨는지)
- [ ] **B-1: 같은 파이프라인으로 마스크 편집 1회 실행 → 출력 품질 육안 평가.** 비교군: 같은 입력·프롬프트를 `QwenImageEditPlusPipeline`으로 마스크 없이 돌린 결과
- [ ] **B-1: `padding_mask_crop=32`로 실행 → 마스크 밖 픽셀이 원본과 비트 단위로 같은지 확인** (numpy diff)
- [ ] `strength` 0.6 / 0.75 / 0.85 / 0.95 비교
- [ ] **B-11: LoRA 어댑터가 `_inpaint`에도 적용되는지** — `set_adapters` 후 `_inpaint`를 4스텝으로 돌려 정상 출력이 나오는지

### 2순위 — 배포 구성 결정

- [ ] **B-5: 양자화별 피크 VRAM** (`torch.cuda.max_memory_allocated()`), 1024² / batch 1, `model_cpu_offload` on/off
  - bf16, FP8, bnb NF4, GGUF Q4_K_M / Q8_0
- [ ] **B-6: 프리셋별 소요 시간** (4 / 8 / 40 스텝, 1024²) — Ideogram 28 / 50 / 127 s와 직접 비교
- [ ] **모델 로드 시간** (Ideogram fp8는 ~3.6분) — 워밍업 정책 결정용
- [ ] LoRA on/off **런타임 전환 비용** (`set_adapters` / `disable_lora` + 스케줄러 교체)
- [ ] **B-7: NF4 / FP8 / bf16 품질 격차**, 특히 한글·영문 텍스트 렌더링 (슬라이드 이미지에 글자가 자주 들어간다)
- [ ] **B-3: `QwenImageTransformer2DModel.from_single_file("…qwen_image_edit_2511_fp8_e4m3fn_scaled.safetensors", config="Qwen/Qwen-Image-Edit-2511", subfolder="transformer")` 성공 여부**
- [ ] **B-4: `GGUFQuantizationConfig` + `from_single_file`로 `unsloth/Qwen-Image-Edit-2511-GGUF` Q4_K_M / Q8_0 로드 성공 여부**

### 3순위 — 파라미터 튜닝

- [ ] **B-10: `padding_mask_crop`** 32 / 64 / 128 비교
- [ ] **B-8: 아웃페인팅 알파 평탄화 배경색** — edge-replicate / 중립회색(128) / 흰색 3가지로 같은 입력 실행 후 비교
- [ ] **B-8: 페더 폭** 8 / 12 / 16 / 24 비교 (경계 이음매)
- [ ] 아웃페인팅 프롬프트 A/B — 기존 "transparent letterbox" 문구 vs §E-4의 "Extend the existing scene outward" 문구
- [ ] **B-2 (선택): 흰/회색 단색 캔버스로 EditPlus T2I 흉내** — 쓸 만한 품질이 나오면 G-1c가 열린다

### 4순위 — 병행 적재 결정 (48 GB+ 머신에서만)

- [ ] `QwenImagePipeline.from_pretrained("Qwen/Qwen-Image-2512", text_encoder=…, tokenizer=…, vae=…)` 로 컴포넌트 공유 적재 성공 여부
- [ ] 공유 적재 시 실제 증분 VRAM이 트랜스포머 크기와 일치하는지

---

# 부록. 읽은 파일과 근거 위치

## 저장소 코드 (읽기만 함, 수정 없음)

| 파일 | 무엇을 확인했나 |
|---|---|
| `imgen-server/server.py` | 현행 엔드포인트·응답 헤더·CORS/PNA 패턴 |
| `imgen-server/generator.py` | 현행 로드·프리셋·안전필터 재시도·`_gen_lock` 직렬화 |
| `imgen-server/README.md` / `Dockerfile` / `requirements.txt` / `build-and-push.sh` | 배포 형태·HF 토큰 요구·VRAM 안내 |
| `src/core/ImagenBackendClient.js` | `/api/health` 소비 필드, `probeImagenBackend`, `generateLayoutImage`, `X-Safety-Blocked` 처리 |
| `src/core/imageJobRunner.js` | 4가지 작업의 실제 요구, `composeContainFit`, `startCaptureEditJob`, `genSizeForBox` |
| `src/core/OpenAIClient.js:393-436` | 현행 `editImage` 계약(입력 + 프롬프트 + 선택적 mask PNG, 투명=편집) |
| `src/components/MaskBrushOverlay.jsx:117-138` | `buildMask` — 마스크 극성의 근거 |
| `src/components/AiActionBar.jsx:119-126` | 마스크 콜백 전달 방식 |
| `src/core/captureCanvasRegion.js:57` | 캡처 `scale: 2` |

## 외부 출처

| 출처 | URL |
|---|---|
| Qwen-Image-Edit-2511 모델카드 | https://huggingface.co/Qwen/Qwen-Image-Edit-2511 |
| Qwen-Image-2512 모델카드 | https://huggingface.co/Qwen/Qwen-Image-2512 |
| Qwen-Image GitHub | https://github.com/QwenLM/Qwen-Image |
| diffusers qwenimage 파이프라인 | https://github.com/huggingface/diffusers/tree/main/src/diffusers/pipelines/qwenimage |
| diffusers QwenImage 문서 | https://huggingface.co/docs/diffusers/main/en/api/pipelines/qwenimage |
| lightx2v Lightning (2511) | https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning |
| ModelTC/Qwen-Image-Lightning | https://github.com/ModelTC/Qwen-Image-Lightning |
| unsloth GGUF | https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF |
| 1038lab FP8 | https://huggingface.co/1038lab/Qwen-Image-Edit-2511-FP8 |

## diffusers 소스 근거 위치

| 파일 | 행 | 내용 |
|---|---|---|
| `pipelines/qwenimage/__init__.py` | — | 파이프라인 클래스 목록(`QwenImageEditPlusPipeline`, `QwenImageEditInpaintPipeline`, `QwenImageLayeredPipeline` 등) |
| `pipeline_qwenimage_edit_plus.py` | 66-67 | `CONDITION_IMAGE_SIZE = 384*384`, `VAE_IMAGE_SIZE = 1024*1024` |
| 〃 | 158-165 | `calculate_dimensions` |
| 〃 | 208-216 | `vae_scale_factor`, `image_processor`, 프롬프트 템플릿 |
| 〃 | 238 | `img_prompt_template = "Picture {}: <\|vision_start\|>…"` |
| 〃 | 244, 690 | 하위 헬퍼의 `image is not None` 처리 |
| 〃 | **645** | **`image.size` — None 가드 없음(§답3)** |
| 〃 | 646-655 | 해상도 계산 + 16배수 내림 |
| 〃 | 699-705 | 조건/VAE 이미지 이중 리사이즈 |
| 〃 | 753-761 | `img_shapes` (N개 조건) |
| 〃 | `prepare_latents` | **순수 노이즈 초기화(§A-3)** |
| `pipeline_qwenimage_edit_inpaint.py` | `__init__` | 6개 컴포넌트 — EditPlus와 동일(§답1-A) |
| 〃 | 222 | 구형 프롬프트 템플릿 |
| 〃 | 346, 382-393 | `padding_mask_crop` + PIL 강제 검증 |
| 〃 | 464-473 | `get_timesteps` (strength) |
| 〃 | 505-539 | `prepare_latents` — **img2img 초기화(§답1-B(1))** |
| 〃 | 544-615 | `prepare_mask_latents` |
| 〃 | 693-699 | `mask_image` docstring — **흰=편집(§A-4)** |
| 〃 | **784-789** | **`height`/`width` 무시(§답1 제약1)** |
| 〃 | 828-845 | 전처리 + `crops_coords` |
| 〃 | 923-941 | 마스크 준비 + `img_shapes` |
| 〃 | 976-980 | `latent_model_input = cat([latents, image_latents])` |
| 〃 | **1031** | **`latents = (1-init_mask)*init_latents_proper + init_mask*latents`(§답1-B(2))** |
| 〃 | **1072-1074** | **`apply_overlay`(§답1-B(3))** |
| `image_processor.py` | 96-124 | `do_convert_rgb=False`, `do_binarize=False` 기본값 |
| 〃 | 288-296 | `get_crop_region` |
| 〃 | 523-535 | `binarize` — 0.5 임계 |
| 〃 | **788-828** | **`apply_overlay`** |
| `models/transformers/transformer_qwenimage.py` | 791-793 | `FromOriginalModelMixin` 상속 |
| 〃 | 963-1022 | `zero_cond_t` 처리 |
| `loaders/single_file_model.py` | 192-195 | `QwenImageTransformer2DModel` 항등 매핑 엔트리 |
| `loaders/single_file_utils.py` | — | qwen 참조 0건 |
