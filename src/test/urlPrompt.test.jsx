import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { UrlPromptHost, promptUrl } from '../components/UrlPrompt'

describe('UrlPrompt 커스텀 URL 팝업', () => {
  it('초깃값이 입력창에 채워지고 적용 시 trim된 값을 resolve', async () => {
    render(<UrlPromptHost />)
    let resolved
    act(() => { promptUrl({ title: '링크', initialValue: 'https://' }).then(v => { resolved = v }) })

    const input = await screen.findByRole('textbox')
    expect(input.value).toBe('https://')
    fireEvent.change(input, { target: { value: '  https://a.com  ' } })
    fireEvent.click(screen.getByText('적용'))

    await waitFor(() => expect(resolved).toBe('https://a.com'))
    // 닫힘
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Enter로 적용', async () => {
    render(<UrlPromptHost />)
    let resolved
    act(() => { promptUrl({ initialValue: 'https://b.com' }).then(v => { resolved = v }) })
    const input = await screen.findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(resolved).toBe('https://b.com'))
  })

  it('Esc로 취소하면 null', async () => {
    render(<UrlPromptHost />)
    let resolved = 'sentinel'
    act(() => { promptUrl({ initialValue: 'https://c.com' }).then(v => { resolved = v }) })
    const input = await screen.findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(resolved).toBeNull())
  })

  it('빈 값으로 적용하면 null', async () => {
    render(<UrlPromptHost />)
    let resolved = 'sentinel'
    act(() => { promptUrl({ initialValue: '' }).then(v => { resolved = v }) })
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('적용'))
    await waitFor(() => expect(resolved).toBeNull())
  })
})
