import { useMemo, useState } from 'react'
import { Archive, BriefcaseBusiness, Plus, RotateCcw } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { archivePmJob, restorePmJob } from '../data/pmFirestore'
import { usePmShellOutlet } from '../hooks/usePmOutlet'
import { jobBomPath, jobCanvasPath, jobDrawingsPath, jobPath, jobPmPath } from '../utils/pmRoutes'

function includesSearch(haystack: string | undefined, needle: string) {
  return (haystack || '').toLowerCase().includes(needle)
}

export default function PmJobsPage() {
  const location = useLocation()
  const { user, jobs, loading, openCreateJob } = usePmShellOutlet()
  const [jobView, setJobView] = useState<'active' | 'archived'>('active')
  const [pendingJobId, setPendingJobId] = useState('')
  const searchText = new URLSearchParams(location.search).get('search')?.trim().toLowerCase() || ''

  const scopedJobs = useMemo(() => {
    return jobs.filter(job => (jobView === 'archived' ? job.status === 'archived' : job.status !== 'archived'))
  }, [jobView, jobs])

  const visibleJobs = searchText
    ? scopedJobs.filter(job => [job.title, job.customer, job.siteAddress].some(value => includesSearch(value, searchText)))
    : scopedJobs

  return (
    <div className="pm-page">
      <section className="pm-hero">
        <div>
          <div className="pm-section-eyebrow">Jobs</div>
          <h1 className="pm-page-title">Scaffold job portfolio</h1>
          <p className="pm-page-subtitle">Manage backlog, active work, review, and completion from one premium project area.</p>
        </div>
        <button className="pm-primary-btn" type="button" onClick={openCreateJob}>
          <Plus size={16} />
          New job
        </button>
      </section>

      <div className="pm-panel">
        <div className="pm-panel__header">
          <div>
            <div className="pm-panel__title"><BriefcaseBusiness size={16} /> All jobs</div>
            <div className="pm-panel__subtitle">{loading ? 'Loading jobs…' : `${visibleJobs.length} visible`} {searchText ? `for “${searchText}”` : ''}</div>
          </div>
        </div>

        <div className="pm-job-toolbar">
          <div className="pm-segmented" role="tablist" aria-label="Job view">
            <button type="button" className={`pm-segmented__item ${jobView === 'active' ? 'is-active' : ''}`.trim()} onClick={() => setJobView('active')}>
              Active
              <span>{jobs.filter(job => job.status !== 'archived').length}</span>
            </button>
            <button type="button" className={`pm-segmented__item ${jobView === 'archived' ? 'is-active' : ''}`.trim()} onClick={() => setJobView('archived')}>
              Archived
              <span>{jobs.filter(job => job.status === 'archived').length}</span>
            </button>
          </div>
        </div>

        {visibleJobs.length ? (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Site</th>
                  <th>Stage</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map(job => (
                  <tr key={job.id}>
                    <td>
                      <Link className="pm-table__primary pm-table__primary--link" to={jobPath(job.id)}>{job.title}</Link>
	                      <div
	                        className="pm-table__secondary"
	                        title={job.latestDesignRevId ? `Linked design revision: ${job.latestDesignRevId}` : undefined}
	                      >
	                        {job.latestDesignRevId ? 'Design linked' : 'Design link pending'}
	                      </div>
                    </td>
                    <td>{job.customer || '—'}</td>
                    <td>{job.siteAddress || '—'}</td>
                    <td><span className="pm-badge">{job.stageId}</span></td>
                    <td>{job.updatedAt?.toDate?.().toLocaleDateString() || '—'}</td>
                    <td>
                      <div className="pm-table__actions">
		                        <Link className="pm-table-action" to={jobPath(job.id)}>Open</Link>
		                        <Link className="pm-table-action" to={jobCanvasPath(job.id)}>Canvas</Link>
		                        <Link className="pm-table-action" to={jobDrawingsPath(job.id)}>Drawings</Link>
		                        <Link className="pm-table-action" to={jobBomPath(job.id)}>BOM</Link>
		                        <Link className="pm-table-action" to={jobPmPath(job.id)}>Tasks</Link>
                        {job.status === 'archived' ? (
                          <button
	                            className="pm-table-action"
                            type="button"
                            disabled={pendingJobId === job.id}
                            onClick={() => {
                              setPendingJobId(job.id)
                              void restorePmJob(job, user).finally(() => setPendingJobId(''))
                            }}
                          >
	                            <RotateCcw size={14} />
                            Restore
                          </button>
                        ) : (
                          <button
	                            className="pm-table-action pm-table-action--danger"
                            type="button"
                            disabled={pendingJobId === job.id}
                            onClick={() => {
                              setPendingJobId(job.id)
                              void archivePmJob(job, user).finally(() => setPendingJobId(''))
                            }}
                          >
	                            <Archive size={14} />
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pm-empty-state">
            {searchText ? 'No jobs matched your search.' : 'No jobs yet. Create your first job to start the PM workspace.'}
          </div>
        )}
      </div>
    </div>
  )
}