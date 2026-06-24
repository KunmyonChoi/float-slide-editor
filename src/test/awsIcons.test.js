import { describe, it, expect, beforeEach } from 'vitest'
import {
  ICON_CATEGORIES, ICON_LABEL, GROUP_CONTAINERS, GROUP_BY_KIND,
  iconSvg, svgToDataUrl, awsIconDataUrl,
} from '../core/awsIcons'
import { useFlatStore } from '../store/flatStore'

describe('awsIcons 레지스트리', () => {
  it('카테고리의 모든 아이콘 id가 번들된 SVG로 해석된다', () => {
    for (const cat of ICON_CATEGORIES) {
      for (const ic of cat.icons) {
        const svg = iconSvg(ic.id)
        expect(svg, `${cat.key}/${ic.id}`).toBeTruthy()
        expect(svg).toContain('<svg')
      }
    }
  })

  it('ICON_LABEL이 모든 아이콘을 커버한다', () => {
    const total = ICON_CATEGORIES.reduce((n, c) => n + c.icons.length, 0)
    expect(Object.keys(ICON_LABEL).length).toBe(total)
  })

  it('svgToDataUrl: svg+xml data URL을 만든다', () => {
    const url = svgToDataUrl('<svg><rect/></svg>')
    expect(url.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(url.split(',')[1])).toBe('<svg><rect/></svg>')
  })

  it('awsIconDataUrl: 알 수 없는 id면 null', () => {
    expect(awsIconDataUrl('Nope-Not-A-Service')).toBeNull()
    expect(awsIconDataUrl('EC2')).toContain('data:image/svg+xml,')
  })

  it('그룹 컨테이너는 kind/label/color/dashed를 가진다', () => {
    expect(GROUP_CONTAINERS.length).toBeGreaterThan(0)
    for (const g of GROUP_CONTAINERS) {
      expect(g.kind).toBeTruthy()
      expect(g.label).toBeTruthy()
      expect(g.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(typeof g.dashed).toBe('boolean')
      expect(GROUP_BY_KIND[g.kind]).toBe(g)
    }
  })
})

describe('AWS 아이콘/그룹 삽입 액션', () => {
  beforeEach(() => {
    useFlatStore.setState({ flatElements: [], selectedFlatIds: [], canvasSize: { w: 1280, h: 720 } })
  })

  it('insertAwsIcon: 아이콘 이미지 + 라벨을 한 그룹으로 추가', () => {
    useFlatStore.getState().insertAwsIcon('EC2', 200, 150)
    const els = useFlatStore.getState().flatElements
    expect(els.length).toBe(2)
    const img = els.find(e => e.type === 'image')
    const label = els.find(e => e.type === 'text')
    expect(img.content).toContain('data:image/svg+xml,')
    expect(label.content).toBe(ICON_LABEL['EC2'])
    expect(img.groupId).toBeTruthy()
    expect(img.groupId).toBe(label.groupId)
    // 둘 다 선택됨
    expect(useFlatStore.getState().selectedFlatIds.sort()).toEqual([img.id, label.id].sort())
  })

  it('insertAwsIcon: 알 수 없는 아이콘이면 아무것도 추가하지 않음', () => {
    useFlatStore.getState().insertAwsIcon('Nope', 0, 0)
    expect(useFlatStore.getState().flatElements.length).toBe(0)
  })

  it('insertAwsGroup: 경계 박스(도형) + 라벨을 한 그룹으로 추가하고 색을 입힌다', () => {
    useFlatStore.getState().insertAwsGroup('vpc', 400, 300)
    const els = useFlatStore.getState().flatElements
    expect(els.length).toBe(2)
    const rect = els.find(e => e.type === 'shape')
    const label = els.find(e => e.type === 'text')
    expect(rect.styles.border).toContain(GROUP_BY_KIND['vpc'].color)
    expect(label.content).toBe('VPC')
    expect(rect.groupId).toBe(label.groupId)
  })

  it('insertAwsGroup: 알 수 없는 kind면 무시', () => {
    useFlatStore.getState().insertAwsGroup('bogus', 0, 0)
    expect(useFlatStore.getState().flatElements.length).toBe(0)
  })
})
