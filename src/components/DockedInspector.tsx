import { useEffect, useMemo, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { PropertiesPanel } from './PropertiesPanel'
import './DockedInspector.css'

type DockSide = 'left' | 'right'

type PersistedInspectorUi = {
	  v: 2
  collapsed: boolean
  dockSide: DockSide
}

const STORAGE_KEY = 'scaffoldpro-inspector-ui'

function isTextInput(el: EventTarget | null) {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function readPersisted(): PersistedInspectorUi | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
	    const parsed = JSON.parse(raw) as any
			// Back-compat: v1 stored tab state; Option A no longer uses tabs.
			if (parsed?.v === 1) {
				if (parsed.dockSide !== 'left' && parsed.dockSide !== 'right') return null
				if (typeof parsed.collapsed !== 'boolean') return null
				return { v: 2, collapsed: parsed.collapsed, dockSide: parsed.dockSide } satisfies PersistedInspectorUi
			}
			if (parsed?.v !== 2) return null
			if (parsed.dockSide !== 'left' && parsed.dockSide !== 'right') return null
			if (typeof parsed.collapsed !== 'boolean') return null
			return parsed as PersistedInspectorUi
  } catch {
    return null
  }
}

function writePersisted(next: PersistedInspectorUi) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

/**
 * DockedInspector
 * High-end CAD-style inspector:
 * - persistent docked panel (no layout jumping)
 * - collapsible to a slim rail
 * - tabs: Inspector (selection) + Workspace (mode)
 * - auto-focus Workspace tab on mode switch, but avoid interrupting text edits
 * - persists UI state (collapsed/tab/dockSide) for a premium feel
 */
export function DockedInspector() {
  const rootRef = useRef<HTMLElement | null>(null)

  const persisted = useMemo(() => readPersisted(), [])

  const [dockSide] = useState<DockSide>(persisted?.dockSide ?? 'left')
  const [collapsed, setCollapsed] = useState<boolean>(persisted?.collapsed ?? false)

  // Persist UI state.
  useEffect(() => {
	    writePersisted({ v: 2, collapsed, dockSide })
	  }, [collapsed, dockSide])

  // Keyboard shortcut: P toggles collapse (Blender/Fusion-style panel toggle)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'p' && e.key !== 'P') return
      if (isTextInput(e.target)) return

      e.preventDefault()
      setCollapsed(prev => !prev)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

	  const headerTitle = 'Properties'

  return (
    <aside
      ref={el => {
        rootRef.current = el
      }}
      className={`docked-inspector dock-${dockSide} ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Inspector"
    >
      <div className="docked-inspector-header">
        <div className="docked-inspector-title" title={headerTitle}>
          {headerTitle}
        </div>

        <button
          type="button"
          className="docked-inspector-icon-btn"
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand panel (P)' : 'Collapse panel (P)'}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className="docked-inspector-body" role="tabpanel">
	        <PropertiesPanel />
      </div>
    </aside>
  )
}
