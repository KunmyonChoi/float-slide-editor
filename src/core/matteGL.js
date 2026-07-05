/**
 * matteGL — WebGL로 영상 + 알파 매트를 실시간 합성(GPU).
 *
 * MatteVideoPlayer의 2D(source-in) 경로 GPU 대체. 매 프레임:
 *   1) 영상 프레임을 RGBA 텍스처로 업로드(texImage2D(video) — 빠름)
 *   2) 매트를 단일채널(LUMINANCE) Uint8 텍스처로 업로드(JS 픽셀 루프 불필요)
 *   3) 셰이더가 vec4(videoRGB, maskAlpha) 출력
 * 매트 텍스처는 LINEAR 필터로 영상 해상도에 업스케일 → 소프트 엣지 무료.
 * 미지원/실패 시 null 반환 → 호출부가 2D 경로로 폴백.
 */

const PROC_MAX = 960

// UV의 Y를 반전해 영상·마스크를 함께 정립(위-아래) 표시. UNPACK_FLIP_Y_WEBGL을 쓰지 않는
// 이유: ArrayBufferView(LUMINANCE 마스크) 업로드에 FLIP_Y를 적용하면 INVALID_OPERATION이
// 발생해 텍스처가 비므로. 셰이더에서 두 텍스처를 같은 v_uv로 뒤집으면 정합이 유지된다.
const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_mask;
uniform float u_hasMask;
void main() {
  vec3 rgb = texture2D(u_video, v_uv).rgb;
  float a = u_hasMask > 0.5 ? texture2D(u_mask, v_uv).r : 1.0;
  gl_FragColor = vec4(rgb, a);
}`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null }
  return sh
}

/**
 * canvas에 WebGL 매트 합성 렌더러 생성. 미지원/실패 시 null.
 * @returns {null | { render(video, maskU8, mw, mh): void, dispose(): void }}
 */
export function createMatteRenderer(canvas) {
  let gl
  try {
    const opts = { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true, antialias: false }
    gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)
  } catch { return null }
  if (!gl) return null

  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  // LUMINANCE(1바이트/px) 마스크 행 정렬 안전(NPOT 폭 대비). FLIP_Y는 셰이더에서 처리.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  const makeTex = () => {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return t
  }
  const videoTex = makeTex()
  const maskTex = makeTex()

  const U = {
    video: gl.getUniformLocation(prog, 'u_video'),
    mask: gl.getUniformLocation(prog, 'u_mask'),
    hasMask: gl.getUniformLocation(prog, 'u_hasMask'),
  }

  let disposed = false
  function render(video, maskU8, mw, mh) {
    if (disposed) return
    const vw = video.videoWidth | 0, vh = video.videoHeight | 0
    if (!vw || !vh) return
    const scale = Math.min(1, PROC_MAX / Math.max(vw, vh))
    const cw = Math.max(1, Math.round(vw * scale)), ch = Math.max(1, Math.round(vh * scale))
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(prog)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, videoTex)
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video) }
    catch { return } // CORS tainted 등 — 호출부 폴백
    gl.uniform1i(U.video, 0)

    const hasMask = !!(maskU8 && mw && mh)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, maskTex)
    if (hasMask) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, mw, mh, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, maskU8)
    }
    gl.uniform1i(U.mask, 1)
    gl.uniform1f(U.hasMask, hasMask ? 1 : 0)

    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  function dispose() {
    disposed = true
    try {
      gl.deleteTexture(videoTex); gl.deleteTexture(maskTex); gl.deleteBuffer(buf)
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch { /* noop */ }
  }
  return { render, dispose }
}
