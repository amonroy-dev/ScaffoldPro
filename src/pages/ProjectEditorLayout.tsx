import type { ReactNode } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { ProjectPersistence } from '../components/ProjectPersistence'
import { CatalogProvider } from '../contexts/CatalogContext'
import { ProjectSessionProvider } from '../contexts/ProjectSessionContext'
import { ScaffoldBaseSettingsProvider } from '../contexts/ScaffoldBaseSettings'
import { SettingsProvider } from '../contexts/SettingsContext'
import { ToolProvider } from '../contexts/ToolContext'
import { homePath } from '../pm/utils/pmRoutes'

export function ProjectWorkspaceProviders({ projectId, children }: { projectId: string; children: ReactNode }) {
  return (
    <ProjectSessionProvider key={projectId} projectId={projectId}>
      <SettingsProvider>
        <CatalogProvider>
          <ToolProvider>
            <ProjectPersistence projectId={projectId} />
            <ScaffoldBaseSettingsProvider>{children}</ScaffoldBaseSettingsProvider>
          </ToolProvider>
        </CatalogProvider>
      </SettingsProvider>
    </ProjectSessionProvider>
  )
}

export default function ProjectEditorLayout() {
  const { projectId } = useParams()

  if (!projectId) {
    return <Navigate to={homePath()} replace />
  }

  return (
    <ProjectWorkspaceProviders projectId={projectId}>
      <Outlet />
    </ProjectWorkspaceProviders>
  )
}