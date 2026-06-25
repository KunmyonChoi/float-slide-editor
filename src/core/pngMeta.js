/**
 * pngMeta — PNG 파일에 iTXt 메타데이터 청크 삽입 (외부 라이브러리 없음)
 *
 * PNG 표준(RFC 2083)의 iTXt 청크를 사용. IHDR 바로 뒤에 삽입.
 * ExifTool / macOS Preview / Adobe 툴 등에서 확인 가능.
 */

// CRC32 look-up table
const _CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf, from, to) {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = _CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32be(b, o, v) {
  b[o] = (v >>> 24) & 0xff
  b[o + 1] = (v >>> 16) & 0xff
  b[o + 2] = (v >>> 8) & 0xff
  b[o + 3] = v & 0xff
}

const _ENC = new TextEncoder()

/** UTF-8 iTXt 청크 생성: keyword\0 + flags(2) + lang\0 + transKw\0 + text */
function iTXtChunk(keyword, text) {
  const kw = _ENC.encode(keyword)
  const tx = _ENC.encode(text)
  // 구조: [kw] \0 \0(compFlag) \0(compMethod) \0(lang) \0(transKw) [text]
  const data = new Uint8Array(kw.length + 5 + tx.length)
  data.set(kw)
  // kw.length+0 ~ +4 은 이미 0으로 초기화됨 (null terminator + flags)
  data.set(tx, kw.length + 5)

  const TYPE = new Uint8Array([0x69, 0x54, 0x58, 0x74]) // 'iTXt'
  const chunk = new Uint8Array(4 + 4 + data.length + 4)
  u32be(chunk, 0, data.length)
  chunk.set(TYPE, 4)
  chunk.set(data, 8)
  u32be(chunk, 8 + data.length, crc32(chunk, 4, 8 + data.length))
  return chunk
}

function xmlEsc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Adobe XMP 호환 메타데이터 XML (iTXt "XML:com.adobe.xmp" 청크에 삽입) */
function buildXMP(description, software) {
  return [
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>`,
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    '  xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '  xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(description)}</rdf:li></rdf:Alt></dc:description>`,
    `<xmp:CreatorTool>${xmlEsc(software)}</xmp:CreatorTool>`,
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n')
}

/**
 * PNG data URL에 iTXt 메타데이터 청크를 삽입해 반환한다.
 *
 * @param {string} dataUrl  `data:image/png;base64,...`
 * @param {object} opts
 * @param {string} [opts.description]  원문 텍스트 / 사용자 입력 (iTXt Description)
 * @param {string} [opts.prompt]       AI 이미지 생성 프롬프트 (iTXt Comment)
 * @param {string} [opts.software]     소프트웨어 이름 (기본 'Genitor')
 * @returns {string}  메타데이터가 삽입된 PNG data URL (실패 시 원본 반환)
 */
export function embedPngMetadata(dataUrl, { description = '', prompt = '', software = 'Genitor' } = {}) {
  if (!dataUrl?.startsWith('data:image/png')) return dataUrl
  try {
    // base64 → Uint8Array
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const bin = atob(b64)
    const src = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) src[i] = bin.charCodeAt(i)

    // IHDR 이후(byte 33)에 삽입할 청크 목록 구성
    // PNG 시그니처(8) + IHDR 길이(4) + 'IHDR'(4) + IHDR 데이터(13) + CRC(4) = 33
    const chunks = []
    if (description) chunks.push(iTXtChunk('Description', description))
    if (prompt)      chunks.push(iTXtChunk('Comment', prompt))
    if (software)    chunks.push(iTXtChunk('Software', software))
    if (description || prompt) {
      chunks.push(iTXtChunk('XML:com.adobe.xmp', buildXMP(description || prompt, software)))
    }

    if (chunks.length === 0) return dataUrl

    const extra = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(src.length + extra)
    out.set(src.subarray(0, 33))
    let pos = 33
    for (const c of chunks) { out.set(c, pos); pos += c.length }
    out.set(src.subarray(33), pos)

    // Uint8Array → base64 (대용량 이미지 스택 오버플로 방지: 청크 분할)
    let encoded = ''
    const SLICE = 0x4000
    for (let i = 0; i < out.length; i += SLICE) {
      encoded += String.fromCharCode(...out.subarray(i, Math.min(i + SLICE, out.length)))
    }
    return 'data:image/png;base64,' + btoa(encoded)
  } catch {
    return dataUrl // 실패 시 원본 반환
  }
}
