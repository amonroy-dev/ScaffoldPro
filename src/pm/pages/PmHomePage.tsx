import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BriefcaseBusiness, CalendarRange, Clock3, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import PmTaskCard from '../components/PmTaskCard'
import { fetchPmHomeData } from '../data/pmFirestore'
import { usePmShellOutlet } from '../hooks/usePmOutlet'
import type { PmHomeData } from '../types'
import { formatDateLabel } from '../utils/dates'
import { jobPath, jobsPath } from '../utils/pmRoutes'
import { getPmStageLabel } from '../utils/stageLabels'

export default function PmHomePage() {
  const { user, orgId, jobs, members, loading, homeRefreshKey, openTask, openCreateJob } = usePmShellOutlet()
  const [data, setData] = useState<PmHomeData | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    setPageLoading(true)
    setError('')

    void fetchPmHomeData(orgId, user.uid)
      .then(result => {
        if (!cancelled) setData(result)
      })
      .catch(fetchError => {
        if (cancelled) return
        console.error('[PmHomePage] fetchPmHomeData failed', fetchError)
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load PM home')
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [homeRefreshKey, orgId, user.uid])

  const jobsById = useMemo(() => Object.fromEntries(jobs.map(job => [job.id, job])), [jobs])
  const membersByUid = useMemo(() => Object.fromEntries(members.map(member => [member.uid, member])), [members])
  const activeJobs = useMemo(() => jobs.filter(job => job.status !== 'archived'), [jobs])
  const dueSoon = data?.dueSoon ?? []
  const overdue = data?.overdue ?? []
  const recentJobs = data?.recentJobs ?? []
  const upcomingDeliveries = data?.upcomingDeliveries ?? []
  const jobsByStage = useMemo(() => [...(data?.jobsByStage ?? [])].sort((a, b) => b.count - a.count), [data?.jobsByStage])
  const attentionByJobId = useMemo(() => {
    const counts = new Map<string, { overdue: number; dueSoon: number }>()

    overdue.forEach(task => {
      counts.set(task.jobId, {
        overdue: (counts.get(task.jobId)?.overdue ?? 0) + 1,
        dueSoon: counts.get(task.jobId)?.dueSoon ?? 0,
      })
    })

    dueSoon.forEach(task => {
      counts.set(task.jobId, {
        overdue: counts.get(task.jobId)?.overdue ?? 0,
        dueSoon: (counts.get(task.jobId)?.dueSoon ?? 0) + 1,
      })
    })

    return counts
  }, [dueSoon, overdue])

  const totalAttentionItems = overdue.length + dueSoon.length
  const liveBoardLabel = loading || pageLoading ? 'Refreshing live board' : 'Live board ready'

  const getAssigneeName = (assigneeUid?: string | null) => {
    if (!assigneeUid) return 'Unassigned'
    return membersByUid[assigneeUid]?.displayName || membersByUid[assigneeUid]?.email || 'Unassigned'
  }

  return (
    <div className="pm-page pm-home-page">
      <section className="pm-hero">
        <div>
          <div className="pm-section-eyebrow">PM home</div>
          <h1 className="pm-page-title">Today&apos;s scaffold operations board</h1>
          <p className="pm-page-subtitle">
            Watch the jobs, deadlines, and delivery commitments that need coordination across the workspace.
          </p>
        </div>
        <button className="pm-primary-btn" type="button" onClick={openCreateJob}>
          <Sparkles size={16} />
          Create job
        </button>
      </section>

      {error ? <div className="pm-banner pm-banner--error">{error}</div> : null}

      <section className="pm-panel pm-home-pulse">
        <div className="pm-panel__header">
          <div>
            <div className="pm-panel__title">Operations pulse</div>
            <div className="pm-panel__subtitle">
              A tighter read on workload, coordination pressure, and delivery readiness.
            </div>
          </div>
          <div className={`pm-home-live-pill ${loading || pageLoading ? 'is-loading' : ''}`.trim()}>
            <span className="pm-home-live-pill__dot" aria-hidden="true" />
            {liveBoardLabel}
          </div>
        </div>

        <div className="pm-home-pulse__grid">
          <article className="pm-home-pulse__item">
            <span className="pm-home-pulse__label">Active jobs</span>
            <strong className="pm-home-pulse__value">{activeJobs.length}</strong>
            <span className="pm-home-pulse__hint">Current scaffold workload in motion</span>
          </article>
          <article className="pm-home-pulse__item">
            <span className="pm-home-pulse__label">Coordination queue</span>
            <strong className="pm-home-pulse__value">{totalAttentionItems}</strong>
            <span className="pm-home-pulse__hint">Due-soon and overdue work needing follow-up</span>
          </article>
          <article className="pm-home-pulse__item">
            <span className="pm-home-pulse__label">Jobs at risk</span>
            <strong className="pm-home-pulse__value">{attentionByJobId.size}</strong>
            <span className="pm-home-pulse__hint">Jobs with at least one watch item attached</span>
          </article>
          <article className="pm-home-pulse__item">
            <span className="pm-home-pulse__label">Scheduled deliveries</span>
            <strong className="pm-home-pulse__value">{upcomingDeliveries.length}</strong>
            <span className="pm-home-pulse__hint">Jobs already carrying a delivery commitment</span>
          </article>
        </div>
      </section>

      <section className="pm-home-ops-board" aria-label="Operations watchlists">
        <section className="pm-board-column" data-stage-tone="amber">
          <div className="pm-board-column__header">
            <div className="pm-board-column__header-copy">
              <div className="pm-board-column__eyebrow">
                <span className="pm-board-column__status-dot" /> Immediate attention
              </div>
              <div className="pm-board-column__title-line">
                <div className="pm-panel__title">
                  <AlertTriangle size={16} /> Overdue work
                </div>
                <span className="pm-board-column__count">{overdue.length}</span>
              </div>
              <div className="pm-panel__subtitle">Items that need resequencing or closeout now.</div>
            </div>
          </div>

          <div className="pm-board-column__stack">
            {overdue.length ? (
              overdue.map(task => (
                <PmTaskCard
                  key={task.id}
                  task={task}
                  user={user}
                  assigneeName={getAssigneeName(task.assigneeUid)}
                  stageName={jobsById[task.jobId]?.title}
                  onClick={() => openTask({ jobId: task.jobId, taskId: task.id })}
                />
              ))
            ) : (
              <div className="pm-empty-state pm-empty-state--compact">No overdue work right now.</div>
            )}
          </div>
        </section>

        <section className="pm-board-column" data-stage-tone="blue">
          <div className="pm-board-column__header">
            <div className="pm-board-column__header-copy">
              <div className="pm-board-column__eyebrow">
                <span className="pm-board-column__status-dot" /> Coming due
              </div>
              <div className="pm-board-column__title-line">
                <div className="pm-panel__title">
                  <Clock3 size={16} /> Next 7 days
                </div>
                <span className="pm-board-column__count">{dueSoon.length}</span>
              </div>
              <div className="pm-panel__subtitle">Assigned work that should stay ahead of the field.</div>
            </div>
          </div>

          <div className="pm-board-column__stack">
            {dueSoon.length ? (
              dueSoon.map(task => (
                <PmTaskCard
                  key={task.id}
                  task={task}
                  user={user}
                  assigneeName={getAssigneeName(task.assigneeUid)}
                  stageName={jobsById[task.jobId]?.title}
                  onClick={() => openTask({ jobId: task.jobId, taskId: task.id })}
                />
              ))
            ) : (
              <div className="pm-empty-state pm-empty-state--compact">Nothing due soon. Good runway.</div>
            )}
          </div>
        </section>

        <section className="pm-board-column" data-stage-tone="slate">
          <div className="pm-board-column__header">
            <div className="pm-board-column__header-copy">
              <div className="pm-board-column__eyebrow">
                <span className="pm-board-column__status-dot" /> Delivery watch
              </div>
              <div className="pm-board-column__title-line">
                <div className="pm-panel__title">
                  <CalendarRange size={16} /> Delivery queue
                </div>
                <span className="pm-board-column__count">{upcomingDeliveries.length}</span>
              </div>
              <div className="pm-panel__subtitle">Jobs with delivery dates already committed in the workspace.</div>
            </div>
          </div>

          <div className="pm-board-column__stack">
            {upcomingDeliveries.length ? (
              upcomingDeliveries.map(job => (
                <Link key={job.id} to={jobPath(job.id)} className="pm-job-list__item pm-home-delivery-card">
                  <div>
                    <div className="pm-job-list__title">{job.title}</div>
                    <div className="pm-job-list__meta">
                      {job.customer || 'Customer TBD'} · {job.siteAddress || 'Site TBD'}
                    </div>
                  </div>
                  <div className="pm-job-list__aside">
                    <span>{job.keyDates?.deliveryDate || 'Date TBD'}</span>
                    <span className="pm-badge">{getPmStageLabel(job.stageId)}</span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="pm-empty-state pm-empty-state--compact">
                Add delivery dates to jobs to surface the queue here.
              </div>
            )}
          </div>
        </section>
      </section>

      <div className="pm-page-grid pm-home-page-grid">
        <section className="pm-panel">
          <div className="pm-panel__header">
            <div>
              <div className="pm-panel__title">
                <BriefcaseBusiness size={16} /> Active jobs in motion
              </div>
              <div className="pm-panel__subtitle">Latest job movement across estimating, design, prep, and delivery.</div>
            </div>
            <Link className="pm-text-link" to={jobsPath()}>
              View all <ArrowRight size={14} />
            </Link>
          </div>

          <div className="pm-job-list">
            {recentJobs.length ? (
              recentJobs.map(job => {
                const attention = attentionByJobId.get(job.id)

                return (
                  <Link key={job.id} to={jobPath(job.id)} className="pm-job-list__item">
                    <div>
                      <div className="pm-job-list__title">{job.title}</div>
                      <div className="pm-job-list__meta">
                        {job.customer || 'No customer yet'} · {job.siteAddress || 'Site not confirmed yet'}
                      </div>
                    </div>
                    <div className="pm-home-job-flags">
                      {attention?.overdue ? (
                        <span className="pm-home-chip pm-home-chip--danger">{attention.overdue} overdue</span>
                      ) : null}
                      {attention?.dueSoon ? (
                        <span className="pm-home-chip pm-home-chip--warning">{attention.dueSoon} due soon</span>
                      ) : null}
                      <span className="pm-badge">{getPmStageLabel(job.stageId)}</span>
                      <span className="pm-home-job-updated">Updated {formatDateLabel(job.updatedAt)}</span>
                    </div>
                  </Link>
                )
              })
            ) : (
              <div className="pm-empty-state pm-empty-state--compact">
                No jobs yet. Create your first PM job to start linking work to the 3D editor.
              </div>
            )}
          </div>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__header">
            <div>
              <div className="pm-panel__title">Stage pressure</div>
              <div className="pm-panel__subtitle">Where active jobs are clustering right now.</div>
            </div>
          </div>

          {jobsByStage.length ? (
            <div className="pm-home-stage-summary">
              <div className="pm-home-stage-summary__label">Heaviest current phase</div>
              <div className="pm-home-stage-summary__value">{getPmStageLabel(jobsByStage[0].stageId)}</div>
              <div className="pm-home-stage-summary__hint">
                {jobsByStage[0].count} active {jobsByStage[0].count === 1 ? 'job' : 'jobs'} currently stacked here.
              </div>
            </div>
          ) : null}

          <div className="pm-stage-meter-list">
            {jobsByStage.length ? (
              jobsByStage.map(item => {
                const ratio = activeJobs.length ? Math.max(8, Math.round((item.count / activeJobs.length) * 100)) : 0

                return (
                  <div key={item.stageId} className="pm-stage-meter">
                    <div className="pm-stage-meter__label">
                      <span>{getPmStageLabel(item.stageId)}</span>
                      <strong>{item.count}</strong>
                    </div>
                    <div className="pm-stage-meter__track">
                      <div className="pm-stage-meter__fill" style={{ width: `${ratio}%` }} />
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="pm-empty-state pm-empty-state--compact">
                Stage analytics will appear as soon as jobs are created.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}