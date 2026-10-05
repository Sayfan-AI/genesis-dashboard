import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the selected repository', () => {
    render(<App search="?repo=Sayfan-AI/MaKlaude" />)
    expect(screen.getByRole('heading', { name: 'Genesis Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Sayfan-AI/MaKlaude')).toBeInTheDocument()
  })

  it('prompts for a repository when none is given', () => {
    render(<App search="" />)
    expect(screen.getByText('?repo=owner/name')).toBeInTheDocument()
  })
})
