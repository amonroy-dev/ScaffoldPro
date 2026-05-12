import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

/**
 * Global settings for scaffold base assemblies (wood sill, screw jack, base collar).
 * These are workspace-level toggles that affect all standards.
 */
export interface ScaffoldBaseSettings {
  /** Show wood sills under screw jacks */
  showWoodSill: boolean
  /** Show base collars on top of screw jacks */
  showBaseCollar: boolean
  /** Default screw jack extension in inches (0–12) */
  defaultJackExtensionIn: number
}

export const defaultScaffoldBaseSettings: ScaffoldBaseSettings = {
  showWoodSill: true,
  showBaseCollar: true,
  defaultJackExtensionIn: 6, // 6" default extension
}

interface ScaffoldBaseSettingsContextType {
  baseSettings: ScaffoldBaseSettings
  updateBaseSettings: (partial: Partial<ScaffoldBaseSettings>) => void
  resetBaseSettings: () => void
}

const ScaffoldBaseSettingsContext = createContext<ScaffoldBaseSettingsContextType | null>(null)

const STORAGE_KEY = 'scaffoldpro-scaffold-base-settings'
const SETTINGS_VERSION = 1

export function ScaffoldBaseSettingsProvider({ children }: { children: ReactNode }) {
  const [baseSettings, setBaseSettings] = useState<ScaffoldBaseSettings>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (parsed._version !== SETTINGS_VERSION) {
          localStorage.removeItem(STORAGE_KEY)
          return defaultScaffoldBaseSettings
        }
        return { ...defaultScaffoldBaseSettings, ...parsed }
      } catch {
        return defaultScaffoldBaseSettings
      }
    }
    return defaultScaffoldBaseSettings
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...baseSettings, _version: SETTINGS_VERSION }))
  }, [baseSettings])

  const updateBaseSettings = (partial: Partial<ScaffoldBaseSettings>) => {
    setBaseSettings(prev => ({ ...prev, ...partial }))
  }

  const resetBaseSettings = () => {
    setBaseSettings(defaultScaffoldBaseSettings)
  }

  return (
    <ScaffoldBaseSettingsContext.Provider value={{ baseSettings, updateBaseSettings, resetBaseSettings }}>
      {children}
    </ScaffoldBaseSettingsContext.Provider>
  )
}

export function useScaffoldBaseSettings() {
  const ctx = useContext(ScaffoldBaseSettingsContext)
  if (!ctx) throw new Error('useScaffoldBaseSettings must be used within ScaffoldBaseSettingsProvider')
  return ctx
}

