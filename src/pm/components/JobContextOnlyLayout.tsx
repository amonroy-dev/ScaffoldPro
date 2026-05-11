/**
 * Lightweight layout that loads job data and provides JobWorkspaceContext
 * WITHOUT any PM shell UI chrome (no sidebar, no header, no tabs).
 *
 * Used for dedicated full-page workspaces like Canvas, Drawings, and BOM
 * that need job context but render their own full-screen UI.
 */
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { listenPmJob } from '../data/pmFirestore'
import { JobWorkspaceContext } from '../hooks/useJobWorkspace'
import type { PmJob } from '../types'
import {
  jobBomPath,
  jobCanvasPath,
  jobDrawingsPath,
  jobFilesPath,
  jobPath,
  jobPmPath,
  jobSettingsPath,
  jobsPath,
  jobTasksPath,
} from '../utils/pmRoutes'

export default function JobContextOnlyLayout() {
  const { jobId = '' } = useParams()

  const [job, setJob] = useState<PmJob | null>(null)
  const [loadingJob, setLoadingJob] = useState(true)

  const projectId = job?.latestDesignRevId ?? ''

  useEffect(() => {
    if (!jobId) { setLoadingJob(false); return undefined }
    setLoadingJob(true)
    const stop = listenPmJob(jobId, nextJob => { setJob(nextJob); setLoadingJob(false) })
    return () => stop()
  }, [jobId])

  const workspaceValue = useMemo(() => ({
    jobId,
    projectId,
    job,
    jobHomePath: jobPath(jobId),
    jobsPath: jobsPath(),
    canvasPath: jobCanvasPath(jobId),
    drawingsPath: jobDrawingsPath(jobId),
    bomPath: jobBomPath(jobId),
    tasksPath: jobTasksPath(jobId),
    pmPath: jobPmPath(jobId),
    filesPath: jobFilesPath(jobId),
    settingsPath: jobSettingsPath(jobId),
  }), [job, jobId, projectId])

  if (!jobId) return <Navigate to={jobsPath()} replace />

  if (loadingJob) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1a1a2e', color: '#aaa' }}>
        Loading workspace…
      </div>
    )
  }

  if (!job) {
    return <Navigate to={jobsPath()} replace />
  }

  return (
    <JobWorkspaceContext.Provider value={workspaceValue}>
      <Outlet />
    </JobWorkspaceContext.Provider>
  )
}

