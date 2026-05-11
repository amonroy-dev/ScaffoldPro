import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { Outlet, useNavigate } from 'react-router-dom'
import { auth } from '../../firebase'
import PmTaskDrawer from '../components/PmTaskDrawer'
import { ensureDefaultPmOrg, listenPmOrgMembers } from '../data/pmFirestore'
import { usePmWorkspaceMode } from '../hooks/usePmWorkspaceMode'
import type { PmShellOutletContext } from '../hooks/usePmOutlet'
import type { PmDrawerTarget, PmMember } from '../types'
import { jobsPath } from '../utils/pmRoutes'
import '../pm.css'

export default function StandalonePmJobShellLayout() {
  usePmWorkspaceMode()

  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(() => auth.currentUser)
  const [orgId, setOrgId] = useState('')
  const [members, setMembers] = useState<PmMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTask, setActiveTask] = useState<PmDrawerTarget | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      if (!nextUser) {
        setOrgId('')
        setMembers([])
      }
    })
    return () => unsub()
  }, [])

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
        if (!cancelled) setOrgId(nextOrgId)
      })
      .catch(orgError => {
        if (cancelled) return
        console.error('[StandalonePmJobShellLayout] ensureDefaultPmOrg failed', orgError)
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
      setLoading(false)
    })

    return () => {
      stopMembers()
    }
  }, [orgId])

  if (!user || !orgId) {
    return (
      <div className="pm-boot-screen">
        <div className="pm-boot-screen__card">
          <div className="pm-section-eyebrow">ScaffoldPro PM</div>
          <div className="pm-boot-screen__title">Preparing your workspace…</div>
          <div className="pm-boot-screen__copy">We’re loading the job task workspace without the PM shell chrome.</div>
          {error ? <div className="pm-inline-error">{error}</div> : null}
        </div>
      </div>
    )
  }

  const outletContext: PmShellOutletContext = {
    user,
    orgId,
    members,
    jobs: [],
    loading,
    activeTask,
    homeRefreshKey: 0,
    openTask: setActiveTask,
    closeTask: () => setActiveTask(null),
    openCreateJob: () => navigate(jobsPath()),
  }

  return (
    <div className={`pm-job-shell ${activeTask ? 'pm-job-shell--drawer-open' : ''}`.trim()}>
      <main className="pm-job-shell__main">
        {error ? <div className="pm-banner pm-banner--error">{error}</div> : null}
        <Outlet context={outletContext} />
      </main>

      <PmTaskDrawer target={activeTask} user={user} members={members} onClose={() => setActiveTask(null)} />
    </div>
  )
}
