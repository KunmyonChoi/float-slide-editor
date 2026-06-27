/**
 * chromaGL — WebGL 프래그먼트 셰이더로 영상 크로마키(+디스필)를 실시간 합성.
 *
 * CPU(getImageData/putImageData) 경로의 GPU 대체. 키잉·디스필 수식은 chromaKey.js의
 * CPU 버전과 동일하게 맞춰 시각적 동등성을 보장(회귀 방지). 미지원/실패 시 null 반환 →
 * 호출부가 CPU 경로로 폴백.
 *
 * 정규화 거리 공간(0~1)에서 계산: MAX 거리 = sqrt(3). tolerance/feather 퍼센트를
 * 그 비율로 변환(= CPU의 0~255 공간 비율과 동일).
 */

export const SQRT3 = Math.sqrt(3)
export const CHROMA_MAX_KEYS = 4
// 출력 캔버스 긴 변 상한 — 프래그먼트 수 억제(텍스처는 원본, 그리기만 다운스케일).
const PROC_MAX = 1280

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_count;
uniform vec3 u_key[4];
uniform float u_tol[4];
uniform float u_feather[4];
uniform float u_despill;
uniform int u_spillCh;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  // 키잉: 여러 키 중 하나라도 일치하면 제거(keep의 최소). CPU pixelAlpha의 선형 램프와 동일.
  float alpha = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= u_count) break;
    float d = distance(c.rgb, u_key[i]);
    float keep = clamp((d - (u_tol[i] - u_feather[i])) / max(u_feather[i], 1e-4), 0.0, 1.0);
    alpha = min(alpha, keep);
  }
  // 디스필: 우세 채널을 나머지 두 채널 평균(중립) 쪽으로 강도만큼.
  vec3 rgb = c.rgb;
  if (u_despill > 0.0) {
    float v, o1, o2;
    if (u_spillCh == 0) { v = rgb.r; o1 = rgb.g; o2 = rgb.b; }
    else if (u_spillCh == 1) { v = rgb.g; o1 = rgb.r; o2 = rgb.b; }
    else { v = rgb.b; o1 = rgb.r; o2 = rgb.g; }
    float limit = (o1 + o2) * 0.5;
    if (v > limit) {
      float nv = v - u_despill * (v - limit);
      if (u_spillCh == 0) rgb.r = nv;
      else if (u_spillCh == 1) rgb.g = nv;
      else rgb.b = nv;
    }
  }
  gl_FragColor = vec4(rgb, alpha * c.a);
}`

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh)
    return null
  }
  return sh
}

/**
 * 키 항목 + 디스필 → 셰이더 uniform 배열로 변환(순수 함수, 테스트 대상).
 * entries의 key는 이미 해소된 상태({r,g,b} 0~255)여야 한다(자동 키 추정은 호출부).
 * @returns {{ count, keys:number[12], tols:number[4], feathers:number[4], despill:number, spillCh:number }}
 */
export function prepareChromaUniforms(entries, despillPct, primaryKey) {
  const list = (entries || []).filter(e => e && e.key).slice(0, CHROMA_MAX_KEYS)
  const keys = [], tols = [], feathers = []
  for (let i = 0; i < CHROMA_MAX_KEYS; i++) {
    const e = list[i]
    if (e) {
      keys.push(e.key.r / 255, e.key.g / 255, e.key.b / 255)
      const tol = ((e.tolerance ?? 18) / 100) * SQRT3
      const f = e.feather != null ? Math.max(0, (e.feather / 100) * SQRT3) : Math.max(1 / 255, tol * 0.3)
      tols.push(tol); feathers.push(f)
    } else {
      keys.push(0, 0, 0); tols.push(0); feathers.push(1e-4) // 미사용 슬롯(셰이더 루프가 count까지만)
    }
  }
  const pk = primaryKey || (list[0] && list[0].key) || null
  let spillCh = 1 // 기본 그린
  if (pk) spillCh = (pk.g >= pk.r && pk.g >= pk.b) ? 1 : (pk.b >= pk.r && pk.b >= pk.g) ? 2 : 0
  return {
    count: list.length,
    keys, tols, feathers,
    despill: Math.max(0, Math.min(1, (despillPct ?? 0) / 100)),
    spillCh,
  }
}

/**
 * 주어진 canvas에 WebGL 크로마키 렌더러 생성. 미지원/실패 시 null.
 * @returns {null | { render(video, uniforms): void, dispose(): void, gl }}
 */
export function createChromaRenderer(canvas) {
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

  // 풀스크린 삼각형 2개
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  // 텍스처(영상 프레임 업로드용)
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  const U = {
    tex: gl.getUniformLocation(prog, 'u_tex'),
    count: gl.getUniformLocation(prog, 'u_count'),
    key: gl.getUniformLocation(prog, 'u_key'),
    tol: gl.getUniformLocation(prog, 'u_tol'),
    feather: gl.getUniformLocation(prog, 'u_feather'),
    despill: gl.getUniformLocation(prog, 'u_despill'),
    spillCh: gl.getUniformLocation(prog, 'u_spillCh'),
  }

  let disposed = false
  function render(video, uniforms) {
    if (disposed) return
    const vw = video.videoWidth | 0, vh = video.videoHeight | 0
    if (!vw || !vh) return
    const scale = Math.min(1, PROC_MAX / Math.max(vw, vh))
    const cw = Math.max(1, Math.round(vw * scale)), ch = Math.max(1, Math.round(vh * scale))
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    } catch {
      return // CORS tainted 등 — 호출부 폴백
    }
    gl.uniform1i(U.tex, 0)
    gl.uniform1i(U.count, uniforms.count)
    gl.uniform3fv(U.key, uniforms.keys)
    gl.uniform1fv(U.tol, uniforms.tols)
    gl.uniform1fv(U.feather, uniforms.feathers)
    gl.uniform1f(U.despill, uniforms.despill)
    gl.uniform1i(U.spillCh, uniforms.spillCh)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  function dispose() {
    disposed = true
    try {
      gl.deleteTexture(tex); gl.deleteBuffer(buf)
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch { /* noop */ }
  }
  return { render, dispose, gl }
}
