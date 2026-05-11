import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { BriefcaseBusiness, Home, Inbox, LogOut, Plus, Search } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { auth } from '../../firebase'
import { createPmJob, ensureDefaultPmOrg, listenPmJobs, listenPmOrgMembers } from '../data/pmFirestore'
import { usePmWorkspaceMode } from '../hooks/usePmWorkspaceMode'
import type { PmShellOutletContext } from '../hooks/usePmOutlet'
import type { PmDrawerTarget, PmJob, PmMember } from '../types'
import { homePath, inboxPath, jobPath, jobsPath } from '../utils/pmRoutes'
import PmTaskDrawer from '../components/PmTaskDrawer'
import '../pm.css'

const NAV_ITEMS = [
	  { to: homePath(), label: 'Home', icon: Home },
	  { to: jobsPath(), label: 'Jobs', icon: BriefcaseBusiness },
	  { to: inboxPath(), label: 'Inbox', icon: Inbox },
] as const

const EMPTY_DRAFT = { title: '', customer: '', siteAddress: '' }

export default function PmShellLayout() {
  usePmWorkspaceMode()

  const navigate = useNavigate()
  const location = useLocation()

  const [user, setUser] = useState<User | null>(() => auth.currentUser)
  const [orgId, setOrgId] = useState('')
  const [members, setMembers] = useState<PmMember[]>([])
  const [jobs, setJobs] = useState<PmJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTask, setActiveTask] = useState<PmDrawerTarget | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [homeRefreshKey, setHomeRefreshKey] = useState(0)
  const [draft, setDraft] = useState(EMPTY_DRAFT)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      if (!nextUser) {
        setOrgId('')
        setMembers([])
        setJobs([])
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
	  if (location.pathname !== jobsPath()) return
    const params = new URLSearchParams(location.search)
    setSearchText(params.get('search') ?? '')
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')

    void ensureDefaultPmOrg(user)
      .then(nextOrgId => {
        if (cancelled) return
        setOrgId(nextOrgId)
      })
      .catch(orgError => {
        if (cancelled) return
        console.error('[PmShellLayout] ensureDefaultPmOrg failed', orgError)
        setError(orgError instanceof Error ? orgError.message : 'Unable to initialize your PM workspace')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!orgId) return undefined

    setLoading(true)
    const stopMembers = listenPmOrgMembers(orgId, nextMembers => {
      setMembers(nextMembers)
    })
    const stopJobs = listenPmJobs(orgId, nextJobs => {
      setJobs(nextJobs)
      setLoading(false)
    })

    return () => {
      stopMembers()
      stopJobs()
    }
  }, [orgId])

  const memberCountLabel = useMemo(() => {
    if (members.length === 1) return '1 member'
    return `${members.length} members`
  }, [members.length])
  const activeJobsCount = useMemo(() => jobs.filter(job => job.status !== 'archived').length, [jobs])

  const currentName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'ScaffoldPro User'

  const handleCreateJob = async () => {
    if (!user || !orgId) return
    const title = draft.title.trim()
    if (!title) {
      setError('Job name is required.')
      return
    }

    try {
      setCreatePending(true)
      setError('')
      const jobId = await createPmJob({
        user,
        orgId,
        title,
        customer: draft.customer.trim(),
        siteAddress: draft.siteAddress.trim(),
      })
      setDraft(EMPTY_DRAFT)
      setCreateOpen(false)
      setHomeRefreshKey(value => value + 1)
	      navigate(jobPath(jobId))
    } catch (createError) {
      console.error('[PmShellLayout] createPmJob failed', createError)
      setError(createError instanceof Error ? createError.message : 'Unable to create job')
    } finally {
      setCreatePending(false)
    }
  }

  if (!user || !orgId) {
    return (
      <div className="pm-boot-screen">
        <div className="pm-boot-screen__card">
          <div className="pm-section-eyebrow">ScaffoldPro PM</div>
          <div className="pm-boot-screen__title">Preparing your workspace…</div>
          <div className="pm-boot-screen__copy">We’re checking your org membership and loading your latest jobs.</div>
          {error ? <div className="pm-inline-error">{error}</div> : null}
        </div>
      </div>
    )
  }

  const outletContext: PmShellOutletContext = {
    user,
    orgId,
    members,
    jobs,
    loading,
    activeTask,
    homeRefreshKey,
    openTask: setActiveTask,
    closeTask: () => setActiveTask(null),
    openCreateJob: () => setCreateOpen(true),
  }

  return (
    <div className={`pm-shell ${activeTask ? 'pm-shell--drawer-open' : ''}`.trim()}>
      <aside className="pm-sidebar">
        <div className="pm-sidebar__brand">
          <div className="pm-sidebar__logo">SP</div>
          <div>
            <div className="pm-sidebar__title">ScaffoldPro PM</div>
            <div className="pm-sidebar__subtitle">{currentName} Workspace</div>
          </div>
        </div>

        <button className="pm-primary-btn pm-sidebar__create" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={14} />
          New job
        </button>

        <nav className="pm-sidebar__nav" aria-label="Primary PM navigation">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `pm-sidebar__link ${isActive ? 'is-active' : ''}`.trim()}
              >
                <Icon size={15} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="pm-sidebar__footer">
          <div className="pm-sidebar__workspace-metric">
            <span>Active jobs</span>
            <strong>{activeJobsCount}</strong>
          </div>
          <div className="pm-sidebar__workspace-metric">
            <span>Team</span>
            <strong>{memberCountLabel}</strong>
          </div>
          <button className="pm-secondary-btn pm-sidebar__signout" type="button" onClick={() => void signOut(auth)}>
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="pm-shell__main">
        <header className="pm-topbar">
          <form
            className="pm-search"
            onSubmit={event => {
              event.preventDefault()
              const params = new URLSearchParams()
              if (searchText.trim()) params.set('search', searchText.trim())
	            navigate(`${jobsPath()}${params.toString() ? `?${params.toString()}` : ''}`)
            }}
          >
            <Search size={16} />
            <input
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              placeholder="Search jobs, customers, or addresses"
              aria-label="Search jobs"
            />
          </form>
        </header>

        {error ? <div className="pm-banner pm-banner--error">{error}</div> : null}

        <main className="pm-content">
          <Outlet context={outletContext} />
        </main>
      </div>

      <PmTaskDrawer target={activeTask} user={user} members={members} onClose={() => setActiveTask(null)} />

      {createOpen ? (
        <div className="pm-modal-backdrop" onClick={() => setCreateOpen(false)} role="presentation">
          <div
            className="pm-modal"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Escape') setCreateOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pm-create-job-title"
          >
            <div className="pm-modal__header">
              <div>
                <div className="pm-section-eyebrow">New scaffold job</div>
                <h2 className="pm-modal__title" id="pm-create-job-title">Create a PM job</h2>
              </div>
              <button className="pm-icon-btn" type="button" onClick={() => setCreateOpen(false)} aria-label="Close create job dialog">
                ×
              </button>
            </div>

            <div className="pm-form-grid">
              <div>
                <label className="pm-field-label" htmlFor="pm-job-title">Job name</label>
                <input
                  id="pm-job-title"
                  className="pm-input"
                  value={draft.title}
                  onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}
                  placeholder="South tower access scaffold"
                />
              </div>
              <div>
                <label className="pm-field-label" htmlFor="pm-job-customer">Customer</label>
                <input
                  id="pm-job-customer"
                  className="pm-input"
                  value={draft.customer}
                  onChange={event => setDraft(current => ({ ...current, customer: event.target.value }))}
                  placeholder="General contractor or owner"
                />
              </div>
              <div className="pm-form-grid__full">
                <label className="pm-field-label" htmlFor="pm-job-address">Site address</label>
                <input
                  id="pm-job-address"
                  className="pm-input"
                  value={draft.siteAddress}
                  onChange={event => setDraft(current => ({ ...current, siteAddress: event.target.value }))}
                  placeholder="123 Harbor Industrial Way, Tampa, FL"
                />
              </div>
            </div>

            <div className="pm-modal__footer">
              <button className="pm-secondary-btn" type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button className="pm-primary-btn" type="button" onClick={() => void handleCreateJob()} disabled={createPending}>
                {createPending ? 'Creating…' : 'Create job'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
