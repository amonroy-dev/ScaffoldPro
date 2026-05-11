import { useNavigate } from 'react-router-dom'
import { AppContent } from '../../App'
import { BomDrawer } from '../../components/BomDrawer'
import { DrawingsWorkspace } from '../../components/drawings/DrawingsWorkspace'
import { ProjectWorkspaceProviders } from '../../pages/ProjectEditorLayout'
import { useJobWorkspace } from '../hooks/useJobWorkspace'

/**
 * Canvas route wrapper — mounts ProjectWorkspaceProviders for the 3D canvas.
 * Used at /jobs/:jobId/canvas.
 */
export function JobCanvasRoute() {
	const workspace = useJobWorkspace()

  const projectId = workspace?.projectId ?? ''

  if (!projectId) {
    return (
      <div className="pm-job-layout">
        <div className="pm-banner pm-banner--error">
          This job has no linked design revision — the Canvas workspace cannot be opened.
        </div>
      </div>
    )
  }

  return (
    <ProjectWorkspaceProviders projectId={projectId}>
			<AppContent />
    </ProjectWorkspaceProviders>
  )
}

/**
 * Drawings route wrapper — mounts ProjectWorkspaceProviders for the 2D drawings workspace.
 * Used at /jobs/:jobId/drawings.
 */
export function JobDrawingsRoute() {
  const workspace = useJobWorkspace()
  const projectId = workspace?.projectId ?? ''

  if (!projectId) {
    return (
      <div className="pm-job-layout">
        <div className="pm-banner pm-banner--error">
          This job has no linked design revision — the Drawings workspace cannot be opened.
        </div>
      </div>
    )
  }

  return (
    <ProjectWorkspaceProviders projectId={projectId}>
      <DrawingsWorkspace />
    </ProjectWorkspaceProviders>
  )
}

/**
 * BOM route wrapper — mounts ProjectWorkspaceProviders and renders the BOM UI as a dedicated page.
 * Used at /jobs/:jobId/bom.
 */
export function JobBomRoute() {
  const navigate = useNavigate()
  const workspace = useJobWorkspace()
  const projectId = workspace?.projectId ?? ''

  if (!projectId) {
    return (
      <div className="pm-job-layout">
	        <div className="pm-banner pm-banner--error">
	          This job has no linked design revision — the BOM workspace cannot be opened.
	        </div>
      </div>
    )
  }

  return (
    <ProjectWorkspaceProviders projectId={projectId}>
      <BomDrawer
        isOpen
        variant="page"
        onClose={() => {
          if (workspace) navigate(workspace.canvasPath)
          else navigate(-1)
        }}
      />
    </ProjectWorkspaceProviders>
  )
}