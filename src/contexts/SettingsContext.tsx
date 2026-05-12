import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

// Unit system types
export type UnitSystem = 'imperial' | 'metric'
export type AngleUnit = 'degrees' | 'radians'

// Settings interface with common CAD settings
export interface Settings {
  // Units
  unitSystem: UnitSystem
  decimalPrecision: number
  angleUnit: AngleUnit
  anglePrecision: number
  
  // Grid & Snap
  showGrid: boolean
  gridSize: number // in current units
  snapToGrid: boolean
  snapTolerance: number
  
  // Object Snaps
  snapToEndpoint: boolean
  snapToMidpoint: boolean
  snapToCenter: boolean
  snapToIntersection: boolean
  
  // Display
  showAxes: boolean
  showLegLoads: boolean
  backgroundColor: string
  selectionColor: string
  
  // Camera/Navigation
  orbitSensitivity: number
  zoomSensitivity: number
  invertOrbitVertical: boolean
  
  // Performance
  enableShadows: boolean
  antiAliasing: boolean
  
  // Autosave
  autoSaveEnabled: boolean
  autoSaveInterval: number // minutes
}

// Default settings (imperial/feet as requested)
export const defaultSettings: Settings = {
  unitSystem: 'imperial',
  decimalPrecision: 2,
  angleUnit: 'degrees',
  anglePrecision: 1,
  
  showGrid: true,
  gridSize: 1, // 1 foot
  snapToGrid: true,
  snapTolerance: 0.5,
  
  snapToEndpoint: true,
  snapToMidpoint: true,
  snapToCenter: true,
  snapToIntersection: true,
  
  showAxes: true,
  showLegLoads: true,
  backgroundColor: '#fafaff',
  selectionColor: '#00aa66',
  
  orbitSensitivity: 1,
  zoomSensitivity: 1,
  invertOrbitVertical: false,
  
  enableShadows: true,
  antiAliasing: true,
  
  autoSaveEnabled: true,
  autoSaveInterval: 5,
}

interface SettingsContextType {
  settings: Settings
  updateSettings: (partial: Partial<Settings>) => void
  resetSettings: () => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

const STORAGE_KEY = 'scaffoldpro-settings'
const SETTINGS_VERSION = 2 // Increment to invalidate old cached settings

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    // Load from localStorage on init
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        // Check version - if outdated, use defaults
        if (parsed._version !== SETTINGS_VERSION) {
          localStorage.removeItem(STORAGE_KEY)
          return defaultSettings
        }
        return { ...defaultSettings, ...parsed }
      } catch {
        return defaultSettings
      }
    }
    return defaultSettings
  })

  // Persist to localStorage on change (with version)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, _version: SETTINGS_VERSION }))
  }, [settings])

  const updateSettings = (partial: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...partial }))
  }

  const resetSettings = () => {
    setSettings(defaultSettings)
  }

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
