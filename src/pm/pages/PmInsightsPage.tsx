import { BarChart3, BriefcaseBusiness, ChartNoAxesCombined, Users } from 'lucide-react'
import { useMemo } from 'react'
import { usePmShellOutlet } from '../hooks/usePmOutlet'

export default function PmInsightsPage() {
  const { jobs, members } = usePmShellOutlet()

  const stageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    jobs.forEach(job => counts.set(job.stageId, (counts.get(job.stageId) ?? 0) + 1))
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [jobs])

  return (
    <div className="pm-page">
      <section className="pm-hero">
        <div>
          <div className="pm-section-eyebrow">Insights</div>
          <h1 className="pm-page-title">Portfolio trends</h1>
          <p className="pm-page-subtitle">A founder-friendly insights layer for workload, staffing, and pipeline health.</p>
        </div>
      </section>

      <div className="pm-stat-grid">
        <article className="pm-stat-card"><span className="pm-stat-card__label">Total jobs</span><strong className="pm-stat-card__value">{jobs.length}</strong></article>
        <article className="pm-stat-card"><span className="pm-stat-card__label">Team size</span><strong className="pm-stat-card__value">{members.length}</strong></article>
        <article className="pm-stat-card"><span className="pm-stat-card__label">Dominant stage</span><strong className="pm-stat-card__value">{stageCounts[0]?.[0] || '—'}</strong></article>
      </div>

      <div className="pm-page-grid">
        <section className="pm-panel">
          <div className="pm-panel__title"><BarChart3 size={16} /> Jobs by stage</div>
          <div className="pm-stage-meter-list">
            {stageCounts.length ? (
              stageCounts.map(([stageId, count]) => (
                <div key={stageId} className="pm-stage-meter">
                  <div className="pm-stage-meter__label"><span>{stageId}</span><strong>{count}</strong></div>
                  <div className="pm-stage-meter__track"><div className="pm-stage-meter__fill" style={{ width: `${Math.max(12, Math.round((count / jobs.length) * 100))}%` }} /></div>
                </div>
              ))
            ) : (
              <div className="pm-empty-state pm-empty-state--compact">Create jobs to unlock stage insights.</div>
            )}
          </div>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><Users size={16} /> Staffing view</div>
          <p className="pm-muted-copy">This placeholder will evolve into assignee workload, overdue ownership, and trade coordination analytics.</p>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><BriefcaseBusiness size={16} /> Pipeline health</div>
          <p className="pm-muted-copy">Right now this page emphasizes lightweight portfolio signals rather than heavyweight BI or external reporting integrations.</p>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><ChartNoAxesCombined size={16} /> Future-ready seam</div>
          <p className="pm-muted-copy">The current Firestore model already supports lead time, cycle time, and comments/activity-derived operational signals later.</p>
        </section>
      </div>
    </div>
  )
}