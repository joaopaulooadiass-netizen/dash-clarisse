'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const DARK: Record<string, string> = {
  '--color-bg-primary':     '#15180F',
  '--color-bg-secondary':   '#1C2013',
  '--color-bg-tertiary':    '#262B1A',
  '--color-bg-card':        '#1A1E12',
  '--color-text-primary':   '#F5F2EA',
  '--color-text-secondary': '#D5D2C6',
  '--color-text-muted':     '#A3A294',
  '--color-text-tertiary':  '#82816F',
  '--color-border-subtle':  '#262B1A',
  '--color-border-default': '#333926',
  '--color-border-strong':  '#4A5236',
  '--color-accent':         '#C2E84C',
  '--color-accent-hover':   '#D3E350',
  '--color-accent-muted':   'rgba(194,232,76,0.15)',
}

const LIGHT: Record<string, string> = {
  '--color-bg-primary':     '#F5F2EA',
  '--color-bg-secondary':   '#EFEBDE',
  '--color-bg-tertiary':    '#E6E1CF',
  '--color-bg-card':        '#FDFBF5',
  '--color-text-primary':   '#1C1C1A',
  '--color-text-secondary': '#4A4A42',
  '--color-text-muted':     '#6E6E66',
  '--color-text-tertiary':  '#8A8A7E',
  '--color-border-subtle':  '#E7E2D1',
  '--color-border-default': '#D8D2BC',
  '--color-border-strong':  '#B8B19A',
  '--color-accent':         '#5F8A3C',
  '--color-accent-hover':   '#4E7530',
  '--color-accent-muted':   'rgba(95,138,60,0.14)',
}

function applyTheme(theme: Theme) {
  const vars = theme === 'light' ? LIGHT : DARK
  const root = document.documentElement
  Object.entries(vars).forEach(([key, val]) => root.style.setProperty(key, val))
  root.setAttribute('data-theme', theme)
}

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    // Tema claro creme (design system Salto para o Dólar) é o padrão.
    // O modo escuro é a variante oliva-negro; toggles seguem desligados —
    // religar lendo o localStorage aqui quando quiser reativar.
    applyTheme('light')
  }, [])

  function toggle() {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      applyTheme(next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
