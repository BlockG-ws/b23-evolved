import { PluginMetadata } from '@/plugins/plugin'

const getAccentColor = (): string | null => {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;pointer-events:none;opacity:0;color:AccentColor'
  document.body.appendChild(el)
  const color = getComputedStyle(el).color
  document.body.removeChild(el)
  // Match both rgb() and rgba() formats returned by browsers
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return null
  const r = parseInt(match[1]).toString(16).padStart(2, '0')
  const g = parseInt(match[2]).toString(16).padStart(2, '0')
  const b = parseInt(match[3]).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export const plugin: PluginMetadata = {
  name: 'style.accentColor',
  displayName: '使用系统强调色作为主题颜色',
  description: '将主题颜色设置为操作系统的强调色（Accent Color）',
  setup: async ({ coreApis: { settings } }) => {
    const accentColor = getAccentColor()
    if (accentColor) {
      settings.getGeneralSettings().themeColor = accentColor
    }
  },
}
