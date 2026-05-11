import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BriefcaseBusiness,
  FileDown,
  FileText,
  KanbanSquare,
  LayoutGrid,
  ListTodo,
  Settings,
  Share2,
  Workflow,
} from 'lucide-react'
import { Link, NavLink, Navigate, Outlet, useParams } from 'react-router-dom'
import { listenPmJob } from '../data/pmFirestore'
import { JobWorkspaceContext } from '../hooks/useJobWorkspace'
import { usePmShellOutlet } from '../hooks/usePmOutlet'
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
import '../pm.css'

const TAB_ITEMS = [
  { to: 'pm', label: 'PM Board', icon: KanbanSquare },
  { to: 'canvas', label: 'Canvas', icon: Workflow },
  { to: 'drawings', label: 'Drawings', icon: LayoutGrid },
  { to: 'bom', label: 'BOM', icon: ListTodo },
  { to: 'files', label: 'Files', icon: FileText },
  { to: 'settings', label: 'Settings', icon: Settings },
] as const

export default function JobWorkspaceLayout() {
  const { jobId = '' } = useParams()
  const shell = usePmShellOutlet()

  // Job data
  const [job, setJob] = useState<PmJob | null>(null)
  const [loadingJob, setLoadingJob] = useState(true)

  const projectId = job?.latestDesignRevId ?? ''

  // --- Job listener ---
  useEffect(() => {
    if (!jobId) { setLoadingJob(false); return undefined }
    setLoadingJob(true)
    const stop = listenPmJob(jobId, nextJob => { setJob(nextJob); setLoadingJob(false) })
    return () => stop()
  }, [jobId])

  // --- Context values ---
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
      <div className="pm-job-layout">
        <div className="pm-panel">
          <div className="pm-section-eyebrow">Job workspace</div>
          <h1 className="pm-page-title">Loading workspace…</h1>
          <p className="pm-page-subtitle">Resolving job data.</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="pm-job-layout">
        <section className="pm-job-hero">
          <div>
            <div className="pm-section-eyebrow">Job workspace</div>
            <h1 className="pm-page-title">Job not found</h1>
            <p className="pm-page-subtitle">This job could not be loaded.</p>
          </div>
          <div className="pm-job-hero__actions">
            <Link className="pm-secondary-btn" to={jobsPath()}>Back to jobs</Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <JobWorkspaceContext.Provider value={workspaceValue}>
	    {/*
	      IMPORTANT: .pm-content is a grid with the first row set to 1fr.
	      If this layout returns multiple top-level DOM nodes, the first one will
	      stretch to fill the available vertical space (causing the header to grow/shrink).
	      Wrap everything in a single container so the header stays a fixed height.
	    */}
	    <div className="job-workspace">
	      {/* ── Job header ── */}
	      <section className="job-workspace-header">
	        <div className="job-workspace-header__info">
			        <Link to={jobPath(jobId)} className="job-workspace-header__back" aria-label="Back to current job workspace">
	            <BriefcaseBusiness size={16} />
	            Jobs
	          </Link>
	          <div>
	            <h1 className="job-workspace-header__title">{job.title}</h1>
	            <p className="job-workspace-header__meta">
	              Client: {job.customer || 'TBD'} · Status: <span className="pm-badge">{job.stageId}</span>
	            </p>
	          </div>
	        </div>
	        <div className="job-workspace-header__actions">
	          <button className="pm-secondary-btn" type="button">
	            <FileDown size={16} /> Export
	          </button>
	          <button className="pm-secondary-btn" type="button">
	            <Share2 size={16} /> Share
	          </button>
	          <button className="pm-secondary-btn" type="button">
	            <Archive size={16} /> Archive
	          </button>
	        </div>
	      </section>

	      {/* ── Tab navigation ── */}
	      <nav className="job-workspace-tabs" aria-label="Job workspace tabs">
	        {TAB_ITEMS.map(item => {
	          const Icon = item.icon
	          return (
	            <NavLink
	              key={item.to}
	              to={item.to}
	              className={({ isActive }) => `pm-job-tabs__link ${isActive ? 'is-active' : ''}`.trim()}
	            >
	              <Icon size={15} />
	              {item.label}
	            </NavLink>
	          )
	        })}
	      </nav>

	      {/* ── Page content ── */}
	      <div className="job-workspace__body">
	        <Outlet context={shell} />
	      </div>
	    </div>
    </JobWorkspaceContext.Provider>
  )
}
