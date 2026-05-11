import { useParams, Navigate } from 'react-router-dom'
import App from '../App'
import { ProjectSessionProvider } from '../contexts/ProjectSessionContext'

export default function ProjectWorkspacePage() {
  const { projectId } = useParams()

  if (!projectId) {
    return <Navigate to="/projects" replace />
  }

  // Key by projectId to ensure provider trees reset when switching projects.
  return (
    <ProjectSessionProvider key={projectId} projectId={projectId}>
      <App key={projectId} projectId={projectId} />
    </ProjectSessionProvider>
  )
}
