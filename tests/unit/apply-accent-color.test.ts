import { describe, expect, it } from 'vitest'
import { applyAccentColor } from '@renderer/lib/apply-accent-color'
import { createValueColorPalette, VALUE_COLOR_COUNT } from '@renderer/lib/value-colors'

describe('applyAccentColor', () => {
  it('sets the primary variables and all highlight slot variables', () => {
    const variants = {
      primary: '#00e5ff',
      dark: '#00b8cc',
      dim: 'rgba(0, 229, 255, 0.1)',
      glow: 'rgba(0, 229, 255, 0.4)'
    }
    applyAccentColor(variants)

    const style = document.documentElement.style
    expect(style.getPropertyValue('--color-primary')).toBe('#00e5ff')

    const palette = createValueColorPalette(variants.primary)
    for (let slot = 0; slot < VALUE_COLOR_COUNT; slot++) {
      expect(style.getPropertyValue(`--highlight-color-${slot}`)).toBe(palette.colors[slot])
    }
  })
})
