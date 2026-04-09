/**
 * Export Test Fixtures — 내보내기 라운드트립 테스트용 합성 fixture
 */

let _id = 0

/** 기본 FlatElement 생성 헬퍼 */
export function makeElement(overrides = {}) {
  _id++
  return {
    id: `fix-${_id}`,
    sourceId: `fe-${_id}`,
    type: 'shape',
    content: '',
    isRich: false,
    merged: false,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    zIndex: 0,
    rotation: 0,
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      color: 'rgb(0, 0, 0)',
      fontSize: '16px',
      fontFamily: 'sans-serif',
      fontWeight: '400',
      fontStyle: 'normal',
      lineHeight: 'normal',
      textAlign: 'start',
      letterSpacing: 'normal',
      textTransform: 'none',
      textDecoration: 'none',
      textShadow: 'none',
      borderRadius: '0px',
      border: '0px none rgb(0, 0, 0)',
      boxShadow: 'none',
      opacity: '1',
      overflow: 'hidden',
      padding: '0px',
      ...overrides.styles,
    },
    ...overrides,
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      color: 'rgb(0, 0, 0)',
      fontSize: '16px',
      fontFamily: 'sans-serif',
      fontWeight: '400',
      fontStyle: 'normal',
      lineHeight: 'normal',
      textAlign: 'start',
      letterSpacing: 'normal',
      textTransform: 'none',
      textDecoration: 'none',
      textShadow: 'none',
      borderRadius: '0px',
      border: '0px none rgb(0, 0, 0)',
      boxShadow: 'none',
      opacity: '1',
      overflow: 'hidden',
      padding: '0px',
      ...overrides.styles,
    },
  }
}

/** fixture ID 리셋 (테스트 간 독립성) */
export function resetFixtureIds() {
  _id = 0
}

const CANVAS = { w: 1280, h: 720 }

// ── 개별 fixture ──

export const basicText = {
  name: 'basicText',
  description: '일반 텍스트 1개 — 위치, 크기, 색상, 폰트 검증',
  elements: [
    makeElement({
      type: 'text', content: 'Hello World',
      x: 100, y: 50, width: 400, height: 80, zIndex: 1,
      styles: {
        color: 'rgb(255, 255, 255)',
        fontSize: '48px',
        fontFamily: '"Segoe UI", sans-serif',
        fontWeight: '700',
        textAlign: 'center',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const richText = {
  name: 'richText',
  description: '리치 텍스트 — bold/italic/underline/color 서식 보존',
  elements: [
    makeElement({
      type: 'text', isRich: true,
      content: '<b>Bold</b> <i>Italic</i> <u>Underline</u> <span style="color: #ff0000">Red</span>',
      x: 80, y: 100, width: 600, height: 60, zIndex: 1,
      styles: {
        color: 'rgb(0, 0, 0)',
        fontSize: '24px',
        fontFamily: 'sans-serif',
        overflow: 'visible',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const gradientText = {
  name: 'gradientText',
  description: '그래디언트 텍스트 — webkit-background-clip: text',
  elements: [
    makeElement({
      type: 'text', isRich: true,
      content: '<span style="background-image:linear-gradient(90deg, rgb(0, 229, 255), rgb(79, 70, 229));-webkit-background-clip:text;-webkit-text-fill-color:rgba(0, 0, 0, 0)">Gradient Title</span>',
      x: 200, y: 150, width: 500, height: 70, zIndex: 1,
      styles: {
        color: 'rgb(255, 255, 255)',
        fontSize: '52px',
        fontWeight: '800',
        textAlign: 'center',
        backgroundImage: 'none',
        webkitBackgroundClip: 'border-box',
        overflow: 'visible',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const basicShape = {
  name: 'basicShape',
  description: '배경색+테두리+둥근모서리 도형',
  elements: [
    makeElement({
      type: 'shape',
      x: 50, y: 50, width: 300, height: 200, zIndex: 1,
      styles: {
        backgroundColor: 'rgb(30, 41, 59)',
        border: '2px solid rgb(100, 116, 139)',
        borderRadius: '12px',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const gradientShape = {
  name: 'gradientShape',
  description: 'linear-gradient 배경 도형',
  elements: [
    makeElement({
      type: 'shape',
      x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
      styles: {
        backgroundImage: 'linear-gradient(135deg, rgb(10, 15, 44) 0%, rgb(13, 27, 62) 50%, rgb(10, 37, 64) 100%)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const imageBase64 = {
  name: 'imageBase64',
  description: 'base64 이미지 — data URL 보존, objectFit',
  elements: [
    makeElement({
      type: 'image',
      content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      x: 200, y: 100, width: 400, height: 300, zIndex: 1,
      styles: {
        objectFit: 'cover',
        objectPosition: 'center center',
        borderRadius: '8px',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const svgElement = {
  name: 'svgElement',
  description: 'SVG 콘텐츠 요소',
  elements: [
    makeElement({
      type: 'svg',
      content: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#00e5ff"/></svg>',
      x: 500, y: 300, width: 120, height: 120, zIndex: 3,
      styles: {},
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const videoPlaceholder = {
  name: 'videoPlaceholder',
  description: '비디오 요소 — PPT 플레이스홀더',
  elements: [
    makeElement({
      type: 'video',
      content: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
      x: 100, y: 100, width: 560, height: 315, zIndex: 1,
      styles: {},
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const rotatedElement = {
  name: 'rotatedElement',
  description: '45° 회전 텍스트',
  elements: [
    makeElement({
      type: 'text', content: 'Rotated Text',
      x: 300, y: 200, width: 250, height: 60, zIndex: 1,
      rotation: 45,
      styles: {
        color: 'rgb(0, 0, 0)',
        fontSize: '32px',
        fontWeight: '600',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const multiElement = {
  name: 'multiElement',
  description: '텍스트+도형+이미지 조합 (5개) — z-index 순서',
  elements: [
    makeElement({
      type: 'shape', x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
      styles: { backgroundColor: 'rgb(255, 255, 255)' },
    }),
    makeElement({
      type: 'shape', x: 50, y: 50, width: 400, height: 300, zIndex: 1,
      styles: { backgroundColor: 'rgb(226, 232, 240)', borderRadius: '16px' },
    }),
    makeElement({
      type: 'image',
      content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      x: 500, y: 80, width: 350, height: 250, zIndex: 2,
      styles: { objectFit: 'cover', borderRadius: '12px' },
    }),
    makeElement({
      type: 'text', content: 'Title Text', isRich: false,
      x: 80, y: 400, width: 500, height: 60, zIndex: 3,
      styles: { color: 'rgb(15, 23, 42)', fontSize: '36px', fontWeight: '700', overflow: 'visible' },
    }),
    makeElement({
      type: 'text', content: 'Subtitle description goes here',
      x: 80, y: 470, width: 500, height: 40, zIndex: 4,
      styles: { color: 'rgb(100, 116, 139)', fontSize: '18px', overflow: 'visible' },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const shadowElement = {
  name: 'shadowElement',
  description: 'box-shadow 있는 도형',
  elements: [
    makeElement({
      type: 'shape',
      x: 200, y: 200, width: 300, height: 200, zIndex: 1,
      styles: {
        backgroundColor: 'rgb(255, 255, 255)',
        borderRadius: '16px',
        boxShadow: '0px 10px 30px rgba(0, 0, 0, 0.2)',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const transparentElement = {
  name: 'transparentElement',
  description: 'opacity: 0.5 도형',
  elements: [
    makeElement({
      type: 'shape',
      x: 100, y: 100, width: 400, height: 300, zIndex: 1,
      styles: {
        backgroundColor: 'rgb(59, 130, 246)',
        opacity: '0.5',
        borderRadius: '8px',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const textWithPadding = {
  name: 'textWithPadding',
  description: 'padding+lineHeight 텍스트',
  elements: [
    makeElement({
      type: 'text', content: 'Padded text with line height',
      x: 100, y: 100, width: 400, height: 120, zIndex: 1,
      styles: {
        color: 'rgb(30, 41, 59)',
        fontSize: '20px',
        fontFamily: '"Noto Sans KR", sans-serif',
        lineHeight: '1.8',
        padding: '16px',
        overflow: 'visible',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: ['@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+KR")'],
}

export const multiPageSlides = {
  name: 'multiPageSlides',
  description: '3페이지 다중 슬라이드',
  pages: {
    '0-0': {
      elements: [
        makeElement({
          type: 'shape', x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
          styles: { backgroundColor: 'rgb(15, 23, 42)' },
        }),
        makeElement({
          type: 'text', content: 'Page 1 Title',
          x: 200, y: 300, width: 880, height: 80, zIndex: 1,
          styles: { color: 'rgb(255, 255, 255)', fontSize: '48px', fontWeight: '700', textAlign: 'center', overflow: 'visible' },
        }),
      ],
      canvasSize: CANVAS,
      fontImports: [],
    },
    '1-0': {
      elements: [
        makeElement({
          type: 'shape', x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
          styles: { backgroundColor: 'rgb(255, 255, 255)' },
        }),
        makeElement({
          type: 'text', content: 'Page 2 Content',
          x: 100, y: 200, width: 500, height: 60, zIndex: 1,
          styles: { color: 'rgb(15, 23, 42)', fontSize: '32px', overflow: 'visible' },
        }),
      ],
      canvasSize: CANVAS,
      fontImports: [],
    },
    '2-0': {
      elements: [
        makeElement({
          type: 'text', content: 'Thank you',
          x: 400, y: 300, width: 480, height: 100, zIndex: 0,
          styles: { color: 'rgb(100, 116, 139)', fontSize: '40px', textAlign: 'center', overflow: 'visible' },
        }),
      ],
      canvasSize: CANVAS,
      fontImports: [],
    },
  },
  currentPageKey: '0-0',
}

export const individualBorders = {
  name: 'individualBorders',
  description: '개별 border-top/right/bottom/left 요소',
  elements: [
    makeElement({
      type: 'shape',
      x: 100, y: 100, width: 400, height: 200, zIndex: 1,
      styles: {
        backgroundColor: 'rgb(30, 41, 59)',
        borderTop: '2px solid rgb(0, 229, 255)',
        borderRight: '2px solid rgb(0, 229, 255)',
        borderBottom: '4px solid rgb(79, 70, 229)',
        borderLeft: '1px solid rgb(100, 116, 139)',
        borderRadius: '8px',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const mergedTextValign = {
  name: 'mergedTextValign',
  description: 'merged 텍스트 — 수직 정렬 (alignItems: center)',
  elements: [
    makeElement({
      type: 'text', content: 'Centered Text',
      merged: true,
      x: 100, y: 100, width: 400, height: 200, zIndex: 1,
      styles: {
        color: 'rgb(255, 255, 255)',
        fontSize: '24px',
        backgroundColor: 'rgb(30, 41, 59)',
        textAlign: 'center',
        isFlex: true,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const multiValuePadding = {
  name: 'multiValuePadding',
  description: '다중값 padding 텍스트 (8px 24px)',
  elements: [
    makeElement({
      type: 'text', content: 'Multi-padding text',
      x: 100, y: 100, width: 400, height: 80, zIndex: 1,
      styles: {
        color: 'rgb(15, 23, 42)',
        fontSize: '18px',
        padding: '8px 24px',
        overflow: 'visible',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

export const imageContain = {
  name: 'imageContain',
  description: 'objectFit: contain 이미지',
  elements: [
    makeElement({
      type: 'image',
      content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      x: 200, y: 100, width: 400, height: 300, zIndex: 1,
      styles: {
        objectFit: 'contain',
        objectPosition: 'center center',
        borderRadius: '0px',
        opacity: '0.8',
      },
    }),
  ],
  canvasSize: CANVAS,
  fontImports: [],
}

/** 단일 페이지 fixture 배열 (describe.each용) */
export const singlePageFixtures = [
  basicText,
  richText,
  gradientText,
  basicShape,
  gradientShape,
  imageBase64,
  svgElement,
  videoPlaceholder,
  rotatedElement,
  multiElement,
  shadowElement,
  transparentElement,
  textWithPadding,
  individualBorders,
  mergedTextValign,
  multiValuePadding,
  imageContain,
]
