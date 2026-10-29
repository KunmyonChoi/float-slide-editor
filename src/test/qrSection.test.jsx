import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import FlatPropertyContent from '../components/FlatPropertyContent'
import { useFlatStore } from '../store/flatStore'
import { qrChanges, qrSvg, svgDataUrl } from '../core/qrCode'

function qrEl() {
  const ch = qrChanges({ text: 'https://example.com' })
  return {
    id: 'q1', type: 'image', x: 100, y: 100, width: 300, height: 300, zIndex: 1, isRich: false, merged: false,
    content: ch.content, qr: ch.qr,
    styles: { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', objectFit: 'contain', borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1' },
  }
}
const cur = () => useFlatStore.getState().flatElements.find(e => e.id === 'q1')

describe('속성 패널 QR 섹션', () => {
  beforeEach(() => {
    useFlatStore.setState({ flatElements: [qrEl()], selectedFlatIds: ['q1'], editingFlatId: null, canvasSize: { w: 1280, h: 720 } })
    useFlatStore.getState().clearHistory()
  })

  it('내용을 바꾸면 QR이 다시 그려지고, 실행 취소 한 번에 되돌아간다', () => {
    const { getByPlaceholderText, getByText } = render(<FlatPropertyContent />)
    const box = getByPlaceholderText(/메일 주소/)
    fireEvent.change(box, { target: { value: 'guixiang.jin@sk.com' } })
    expect(getByText('메일 · mailto:guixiang.jin@sk.com')).toBeTruthy()
    expect(cur().content).toBe(svgDataUrl(qrSvg('mailto:guixiang.jin@sk.com'))) // 입력 중 미리보기
    fireEvent.blur(box)
    expect(cur().qr.text).toBe('guixiang.jin@sk.com')
    useFlatStore.getState().undo()
    expect(cur().qr.text).toBe('https://example.com')
    expect(cur().content).toBe(svgDataUrl(qrSvg('https://example.com')))
  })

  it('너무 긴 내용은 알리고 직전 QR을 유지한다', () => {
    const { getByPlaceholderText, getByText } = render(<FlatPropertyContent />)
    const box = getByPlaceholderText(/메일 주소/)
    fireEvent.change(box, { target: { value: 'x'.repeat(3000) } })
    expect(getByText(/너무 깁니다/)).toBeTruthy()
    expect(cur().qr.text).toBe('https://example.com')
    fireEvent.blur(box)
    expect(cur().qr.text).toBe('https://example.com')
  })
})
