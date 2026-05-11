import { BellRing, Clock3, Mailbox, Sparkles } from 'lucide-react'
import { usePmShellOutlet } from '../hooks/usePmOutlet'

export default function PmInboxPage() {
  const { jobs, members } = usePmShellOutlet()

  return (
    <div className="pm-page">
      <section className="pm-hero">
        <div>
          <div className="pm-section-eyebrow">Inbox</div>
          <h1 className="pm-page-title">Notifications and approvals</h1>
          <p className="pm-page-subtitle">
            This placeholder is ready for approvals, mentions, delivery confirmations, and change notices.
          </p>
        </div>
      </section>

      <div className="pm-stat-grid">
        <article className="pm-stat-card"><span className="pm-stat-card__label">Workspace jobs</span><strong className="pm-stat-card__value">{jobs.length}</strong></article>
        <article className="pm-stat-card"><span className="pm-stat-card__label">Team members</span><strong className="pm-stat-card__value">{members.length}</strong></article>
        <article className="pm-stat-card"><span className="pm-stat-card__label">Inbox state</span><strong className="pm-stat-card__value">Placeholder</strong></article>
      </div>

      <div className="pm-page-grid">
        <section className="pm-panel">
          <div className="pm-panel__title"><Mailbox size={16} /> Planned inbox modules</div>
          <ul className="pm-bullet-list">
            <li>Task mentions and comment notifications</li>
            <li>Approval requests for engineering and customer sign-off</li>
            <li>Delivery updates and field change notices</li>
            <li>Unread activity rollups per job</li>
          </ul>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><BellRing size={16} /> Suggested next slice</div>
          <p className="pm-muted-copy">A high-value next step would be unread comment counts plus @mention-style notifications tied to task comments.</p>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><Clock3 size={16} /> Why this is placeholder-first</div>
          <p className="pm-muted-copy">The rest of the PM workflow is live now. Inbox can mature once real activity patterns emerge from daily job use.</p>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><Sparkles size={16} /> Product note</div>
          <p className="pm-muted-copy">Keeping this intentionally light preserves the 4–6 week founder-friendly scope while leaving room for premium notification UX later.</p>
        </section>
      </div>
    </div>
  )
}