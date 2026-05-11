import { useMemo } from 'react'
import { useTool, type WorkspaceMode } from '../contexts/ToolContext'
import './ModeToggle.css'

/**
 * ModeToggle
 * High-end segmented control (mac-like) for switching between:
 * - BUILDING_MODE: site/building reference geometry
 * - SCAFFOLD_MODE: scaffold modeling; building geometry becomes locked reference
 */
export function ModeToggle() {
  const { workspaceMode, setWorkspaceMode } = useTool()

  const isBuilding = workspaceMode === 'BUILDING_MODE'

  const thumbTransform = useMemo(() => {
    return isBuilding ? 'translateX(0%)' : 'translateX(100%)'
  }, [isBuilding])

  const handleSelect = (mode: WorkspaceMode) => {
    if (mode === workspaceMode) return
    setWorkspaceMode(mode)
  }

  return (
    <div className="mode-toggle" role="group" aria-label="Workspace mode">
      <div className={`mode-toggle-track ${isBuilding ? 'is-building' : 'is-scaffold'}`}>
        <div className="mode-toggle-thumb" style={{ transform: thumbTransform }} aria-hidden />

        <button
          type="button"
          className={`mode-toggle-btn ${isBuilding ? 'active' : ''}`}
          onClick={() => handleSelect('BUILDING_MODE')}
          aria-pressed={isBuilding}
          title="Building mode"
        >
          Building
        </button>

        <button
          type="button"
          className={`mode-toggle-btn ${!isBuilding ? 'active' : ''}`}
          onClick={() => handleSelect('SCAFFOLD_MODE')}
          aria-pressed={!isBuilding}
          title="Scaffold mode"
        >
          Scaffold
        </button>
      </div>
    </div>
  )
}

