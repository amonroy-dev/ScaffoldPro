import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore'
import {
  ArrowUpRight,
  Clock3,
  FolderOpen,
  Folders,
  LogOut,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import { createDefaultDrawingPackage } from '../drawings/drawingDocument'
import { auth, db } from '../firebase'
import './ProjectsPage.css'

type ProjectRow = {
  id: string
  name: string
  folderName?: string
  pinned?: boolean
  createdAt?: Timestamp
  updatedAt?: Timestamp
  lastOpenedAt?: Timestamp
}

type SortMode = 'updated' | 'opened' | 'name'

type ProjectDraft = {
  name: string
  folderName: string
}

type FolderOption = {
  key: string
  label: string
  count: number
  latestActivity: number
}

type FolderSection = {
  key: string
  label: string
  description: string
  projects: ProjectRow[]
  latestActivity: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const FILTER_ALL = '__all__'
const FILTER_PINNED = '__pinned__'
const FILTER_UNFILED = '__unfiled__'
const RECENT_PROJECT_LIMIT = 4

function createEmptyProjectData() {
  return {
    schemaVersion: 1,
    data: {
      workspaceMode: 'BUILDING_MODE' as const,
      objects: [],
      scaffoldObjects: [],
      scaffoldStacks: [],
      ledgerConnections: [],
      manualPlankPlacements: [],
      scaffoldBlocks: [],
      drawingPackage: createDefaultDrawingPackage(),
    },
  }
}

const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  name: 'Untitled project',
  folderName: '',
}

function normalizeText(value?: string) {
  return value?.trim() ?? ''
}

function getFolderLabel(folderName?: string) {
  const folder = normalizeText(folderName)
  return folder || 'Unfiled'
}

function timestampMillis(ts?: Timestamp) {
  return ts ? ts.toDate().getTime() : 0
}

function formatWhen(ts?: Timestamp) {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function formatRelativeWhen(ts?: Timestamp) {
  if (!ts) return 'No recent activity'
  const diff = Math.max(0, Date.now() - ts.toDate().getTime())
  const days = Math.floor(diff / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1 week ago'
  if (weeks < 5) return `${weeks} weeks ago`
  return formatWhen(ts)
}

function formatRelativeMillis(ms?: number) {
  if (!ms) return 'No recent activity'
  const diff = Math.max(0, Date.now() - ms)
  const days = Math.floor(diff / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1 week ago'
  if (weeks < 5) return `${weeks} weeks ago`
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

function getProjectActivity(project: ProjectRow) {
  return Math.max(timestampMillis(project.lastOpenedAt), timestampMillis(project.updatedAt))
}

function buildSearchText(project: ProjectRow) {
  return [project.name, project.folderName, project.pinned ? 'pinned' : '']
    .join(' ')
    .toLowerCase()
}

function sortProjects(projects: ProjectRow[], sortMode: SortMode) {
  return projects.sort((a, b) => {
    if (sortMode === 'name') {
      return a.name.localeCompare(b.name)
    }
    if (sortMode === 'opened') {
      const delta = timestampMillis(b.lastOpenedAt) - timestampMillis(a.lastOpenedAt)
      if (delta !== 0) return delta
      return timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt)
    }
    const delta = timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt)
    if (delta !== 0) return delta
    return timestampMillis(b.lastOpenedAt) - timestampMillis(a.lastOpenedAt)
  })
}

function isActiveThisWeek(project: ProjectRow) {
  return getProjectActivity(project) >= Date.now() - 7 * DAY_MS
}

function getProjectSummary(project: ProjectRow) {
  const folder = normalizeText(project.folderName)
  if (project.pinned && folder) return `Pinned in ${folder}`
  if (project.pinned) return 'Pinned for fast access'
  if (folder) return `Grouped inside ${folder}`
  return 'No job folder yet — file it anytime'
}

export default function ProjectsPage() {
  const navigate = useNavigate()

  const [user, setUser] = useState<User | null>(() => auth.currentUser)
  const [authReady, setAuthReady] = useState(() => auth.currentUser !== null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('updated')
  const [activeFolderKey, setActiveFolderKey] = useState<string>(FILTER_ALL)

  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<ProjectDraft>(DEFAULT_PROJECT_DRAFT)

  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<ProjectDraft>(DEFAULT_PROJECT_DRAFT)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      setAuthReady(true)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!authReady) return

    if (!user) {
      setProjects([])
      setError('')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    const q = query(collection(db, 'users', user.uid, 'projects'), orderBy('updatedAt', 'desc'))
    const unsub = onSnapshot(
      q,
      snap => {
        const next: ProjectRow[] = snap.docs.map(d => {
          const data = d.data() as any
          return {
            id: d.id,
            name: typeof data.name === 'string' ? data.name : 'Untitled project',
            folderName: typeof data.folderName === 'string' ? data.folderName : '',
            pinned: data.pinned === true,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            lastOpenedAt: data.lastOpenedAt,
          }
        })
        setProjects(next)
        setLoading(false)
      },
      err => {
        console.error('[ProjectsPage] onSnapshot error:', err)
        setError(err?.message ?? 'Failed to load projects')
        setLoading(false)
      },
    )

    return () => unsub()
  }, [authReady, user])

  const folderOptions = useMemo(() => {
    const map = new Map<string, FolderOption>()
    for (const project of projects) {
      const label = normalizeText(project.folderName)
      if (!label) continue
      const key = label.toLowerCase()
      const current = map.get(key)
      const latestActivity = getProjectActivity(project)
      if (!current) {
        map.set(key, { key, label, count: 1, latestActivity })
        continue
      }
      current.count += 1
      current.latestActivity = Math.max(current.latestActivity, latestActivity)
    }

    return Array.from(map.values()).sort((a, b) => {
      if (b.latestActivity !== a.latestActivity) return b.latestActivity - a.latestActivity
      return a.label.localeCompare(b.label)
    })
  }, [projects])

  const pinnedCount = useMemo(() => projects.filter(project => project.pinned).length, [projects])
  const unfiledCount = useMemo(
    () => projects.filter(project => normalizeText(project.folderName).length === 0).length,
    [projects],
  )
  const activeThisWeekCount = useMemo(
    () => projects.filter(project => isActiveThisWeek(project)).length,
    [projects],
  )

  useEffect(() => {
    if (activeFolderKey === FILTER_ALL || activeFolderKey === FILTER_PINNED || activeFolderKey === FILTER_UNFILED) return
    const stillExists = folderOptions.some(folder => folder.key === activeFolderKey)
    if (!stillExists) {
      setActiveFolderKey(FILTER_ALL)
    }
  }, [activeFolderKey, folderOptions])

  const filteredProjects = useMemo(() => {
    const queryText = search.trim().toLowerCase()
    return sortProjects([...projects], sortMode).filter(project => {
      if (queryText.length > 0 && !buildSearchText(project).includes(queryText)) return false
      if (activeFolderKey === FILTER_PINNED) return project.pinned === true
      if (activeFolderKey === FILTER_UNFILED) return normalizeText(project.folderName).length === 0
      if (activeFolderKey !== FILTER_ALL) return normalizeText(project.folderName).toLowerCase() === activeFolderKey
      return true
    })
  }, [activeFolderKey, projects, search, sortMode])

  const groupedSections = useMemo(() => {
    const sections = new Map<string, FolderSection>()
    for (const project of filteredProjects) {
      const rawFolder = normalizeText(project.folderName)
      const key = rawFolder ? rawFolder.toLowerCase() : FILTER_UNFILED
      const label = rawFolder || 'Unfiled'
      const latestActivity = getProjectActivity(project)
      const current = sections.get(key)

      if (!current) {
        sections.set(key, {
          key,
          label,
          description: rawFolder
            ? `${label} job folder · organize related scaffold models together`
            : 'Projects that have not been assigned to a job folder yet',
          projects: [project],
          latestActivity,
        })
        continue
      }

      current.projects.push(project)
      current.latestActivity = Math.max(current.latestActivity, latestActivity)
    }

    return Array.from(sections.values()).sort((a, b) => {
      const aIsUnfiled = a.key === FILTER_UNFILED
      const bIsUnfiled = b.key === FILTER_UNFILED
      if (aIsUnfiled !== bIsUnfiled) return aIsUnfiled ? 1 : -1
      if (b.latestActivity !== a.latestActivity) return b.latestActivity - a.latestActivity
      return a.label.localeCompare(b.label)
    })
  }, [filteredProjects])

  const recentProjects = useMemo(
    () => [...projects].sort((a, b) => getProjectActivity(b) - getProjectActivity(a)).slice(0, RECENT_PROJECT_LIMIT),
    [projects],
  )

  const showRecentRail = !loading && search.trim().length === 0 && activeFolderKey === FILTER_ALL && recentProjects.length > 0

  const editingProject = useMemo(
    () => (editId ? projects.find(project => project.id === editId) ?? null : null),
    [editId, projects],
  )

  const getRequiredUser = () => {
    if (user) return user
    setError('Authentication is still initializing. Please wait a moment and try again.')
    return null
  }

  const openProject = async (id: string) => {
    const currentUser = getRequiredUser()
    if (!currentUser) return
    try {
      await updateDoc(doc(db, 'users', currentUser.uid, 'projects', id), {
        lastOpenedAt: serverTimestamp(),
      })
    } catch {
      // non-blocking
    }
    navigate(`/app/${id}`)
  }

  const openCreateModal = () => {
    const presetFolder =
      activeFolderKey !== FILTER_ALL &&
      activeFolderKey !== FILTER_PINNED &&
      activeFolderKey !== FILTER_UNFILED
        ? folderOptions.find(folder => folder.key === activeFolderKey)?.label ?? ''
        : ''

    setCreateDraft({
      name: 'Untitled project',
      folderName: presetFolder,
    })
    setCreateOpen(true)
  }

  const closeCreateModal = () => {
    setCreateOpen(false)
    setCreateDraft(DEFAULT_PROJECT_DRAFT)
  }

  const createProject = async () => {
    const currentUser = getRequiredUser()
    if (!currentUser) return
    const name = normalizeText(createDraft.name) || 'Untitled project'
    const folderName = normalizeText(createDraft.folderName)

    try {
      const ref = await addDoc(collection(db, 'users', currentUser.uid, 'projects'), {
        name,
        pinned: false,
        ...(folderName ? { folderName } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastOpenedAt: serverTimestamp(),
        ...createEmptyProjectData(),
      })

      closeCreateModal()
      navigate(`/app/${ref.id}`)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create project')
    }
  }

  const startEdit = (project: ProjectRow) => {
    setEditId(project.id)
    setEditDraft({
      name: project.name,
      folderName: normalizeText(project.folderName),
    })
  }

  const closeEditModal = () => {
    setEditId(null)
    setEditDraft(DEFAULT_PROJECT_DRAFT)
  }

  const applyEdit = async () => {
    const currentUser = getRequiredUser()
    if (!currentUser || !editId) return
    const name = normalizeText(editDraft.name) || 'Untitled project'
    const folderName = normalizeText(editDraft.folderName)

    try {
      await updateDoc(doc(db, 'users', currentUser.uid, 'projects', editId), {
        name,
        folderName,
        updatedAt: serverTimestamp(),
      })
      closeEditModal()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update project')
    }
  }

  const togglePinned = async (project: ProjectRow) => {
    const currentUser = getRequiredUser()
    if (!currentUser) return
    try {
      await updateDoc(doc(db, 'users', currentUser.uid, 'projects', project.id), {
        pinned: !project.pinned,
      })
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update pin state')
    }
  }

  const deleteProject = async (id: string) => {
    const currentUser = getRequiredUser()
    if (!currentUser) return
    const ok = window.confirm('Delete this project? This cannot be undone.')
    if (!ok) return

    try {
      await deleteDoc(doc(db, 'users', currentUser.uid, 'projects', id))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete project')
    }
  }

  const hasProjects = projects.length > 0
  const hasVisibleProjects = filteredProjects.length > 0
  const searchActive = search.trim().length > 0

  return (
    <div className="projects-page">
      <header className="projects-nav">
        <Link to="/" className="projects-logo" aria-label="ScaffoldPro Home">
          <span className="logo-icon">◈</span>
          <span className="logo-text">ScaffoldPro</span>
        </Link>

        <div className="projects-search">
          <Search size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects or job folders…"
            aria-label="Search projects"
          />
        </div>

        <div className="projects-actions">
          <button className="projects-primary" onClick={openCreateModal} type="button">
            <Plus size={16} />
            New project
          </button>
          <button className="projects-ghost" onClick={() => signOut(auth)} title="Sign out" type="button">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="projects-main">
        <section className="projects-hero">
          <div className="projects-hero-copy">
            <div className="projects-kicker">
              <Sparkles size={14} />
              Project hub
            </div>
            <h1>Organize projects by job, not just by file.</h1>
            <p>
              Group scaffold work into folders, pin the projects that matter most, and jump back into
              recent jobs with less friction.
            </p>
            <div className="projects-subtitle">
              {user?.email ? `Signed in as ${user.email}` : 'Signed in'}
            </div>
          </div>

          <div className="projects-hero-panel">
            <div className="hero-panel-title">Built for active jobs</div>
            <div className="hero-panel-copy">
              Folders are created the first time you assign a project to a job folder — no extra admin,
              just cleaner organization.
            </div>
            <button className="projects-primary" onClick={openCreateModal} type="button">
              <Plus size={16} />
              Start a new project
            </button>
          </div>
        </section>

        {error && <div className="projects-error">{error}</div>}

        <section className="projects-stats">
          <div className="projects-stat-card">
            <div className="projects-stat-icon">
              <FolderOpen size={18} />
            </div>
            <div className="projects-stat-value">{projects.length}</div>
            <div className="projects-stat-label">Total projects</div>
          </div>

          <div className="projects-stat-card">
            <div className="projects-stat-icon">
              <Folders size={18} />
            </div>
            <div className="projects-stat-value">{folderOptions.length}</div>
            <div className="projects-stat-label">Job folders</div>
          </div>

          <div className="projects-stat-card">
            <div className="projects-stat-icon">
              <Star size={18} />
            </div>
            <div className="projects-stat-value">{pinnedCount}</div>
            <div className="projects-stat-label">Pinned projects</div>
          </div>

          <div className="projects-stat-card">
            <div className="projects-stat-icon">
              <Clock3 size={18} />
            </div>
            <div className="projects-stat-value">{activeThisWeekCount}</div>
            <div className="projects-stat-label">Active this week</div>
          </div>
        </section>

        <section className="projects-toolbar-shell">
          <div className="projects-toolbar-copy">
            <strong>{loading ? 'Loading projects…' : `${filteredProjects.length} visible projects`}</strong>
            <span>
              {searchActive
                ? 'Search spans project names, folder names, and pinned status'
                : activeFolderKey === FILTER_PINNED
                  ? 'Pinned workspaces across your jobs'
                  : activeFolderKey === FILTER_UNFILED
                    ? 'Projects waiting to be assigned to a job folder'
                    : 'Filter by job folder and keep active work easy to reach'}
            </span>
          </div>

          <div className="projects-toolbar-controls">
            <div className="projects-filter-row" role="tablist" aria-label="Project filters">
              <button
                className={`projects-filter-chip ${activeFolderKey === FILTER_ALL ? 'active' : ''}`}
                onClick={() => setActiveFolderKey(FILTER_ALL)}
                type="button"
              >
                All
                <span>{projects.length}</span>
              </button>

              {pinnedCount > 0 ? (
                <button
                  className={`projects-filter-chip ${activeFolderKey === FILTER_PINNED ? 'active' : ''}`}
                  onClick={() => setActiveFolderKey(FILTER_PINNED)}
                  type="button"
                >
                  Pinned
                  <span>{pinnedCount}</span>
                </button>
              ) : null}

              {folderOptions.map(folder => (
                <button
                  key={folder.key}
                  className={`projects-filter-chip ${activeFolderKey === folder.key ? 'active' : ''}`}
                  onClick={() => setActiveFolderKey(folder.key)}
                  type="button"
                  title={folder.label}
                >
                  {folder.label}
                  <span>{folder.count}</span>
                </button>
              ))}

              {unfiledCount > 0 ? (
                <button
                  className={`projects-filter-chip ${activeFolderKey === FILTER_UNFILED ? 'active' : ''}`}
                  onClick={() => setActiveFolderKey(FILTER_UNFILED)}
                  type="button"
                >
                  Unfiled
                  <span>{unfiledCount}</span>
                </button>
              ) : null}
            </div>

            <label className="projects-sort-field">
              <span>Sort</span>
              <select value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}>
                <option value="updated">Recently updated</option>
                <option value="opened">Recently opened</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
        </section>

        {loading ? (
          <div className="projects-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="project-card skeleton" />
            ))}
          </div>
        ) : !hasProjects ? (
          <div className="projects-empty">
            <div className="empty-title">Create your first project hub</div>
            <div className="empty-subtitle">
              Start a model, assign it to a job folder, and your workspace will begin organizing itself.
            </div>
            <button className="projects-primary" onClick={openCreateModal} type="button">
              <Plus size={16} />
              Create project
            </button>
          </div>
        ) : !hasVisibleProjects ? (
          <div className="projects-empty">
            <div className="empty-title">No projects match this view</div>
            <div className="empty-subtitle">
              Try a different search, clear the folder filter, or create a new project in this job folder.
            </div>
            <div className="projects-empty-actions">
              <button
                className="projects-ghost"
                onClick={() => {
                  setSearch('')
                  setActiveFolderKey(FILTER_ALL)
                }}
                type="button"
              >
                Reset filters
              </button>
              <button className="projects-primary" onClick={openCreateModal} type="button">
                <Plus size={16} />
                New project
              </button>
            </div>
          </div>
        ) : (
          <div className="projects-content-stack">
            {showRecentRail ? (
              <section className="projects-section-shell">
                <div className="projects-section-header">
                  <div>
                    <div className="projects-section-kicker">Recent</div>
                    <h2>Jump back into active work</h2>
                    <p>Your most recently opened or updated scaffold models stay within easy reach.</p>
                  </div>
                </div>

                <div className="projects-grid recent-grid">
                  {recentProjects.map(project => (
                    <article key={`recent-${project.id}`} className={`project-card ${project.pinned ? 'is-pinned' : ''}`}>
                      <div className="project-card-topbar">
                        <div className="project-folder-pill">
                          <FolderOpen size={14} />
                          <span>{getFolderLabel(project.folderName)}</span>
                        </div>

                        <button
                          className={`project-pin-btn ${project.pinned ? 'active' : ''}`}
                          onClick={() => togglePinned(project)}
                          type="button"
                          title={project.pinned ? 'Unpin project' : 'Pin project'}
                          aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
                        >
                          <Star size={16} fill={project.pinned ? 'currentColor' : 'none'} />
                        </button>
                      </div>

                      <div className="project-top">
                        <div className="project-name" title={project.name}>
                          {project.name}
                        </div>
                        <div className="project-summary">{getProjectSummary(project)}</div>
                      </div>

                      <div className="project-activity-pill">Last activity {formatRelativeWhen(project.lastOpenedAt || project.updatedAt)}</div>

                      <div className="project-bottom">
                        <button className="project-open" onClick={() => openProject(project.id)} type="button">
                          Open
                          <ArrowUpRight size={16} />
                        </button>

                        <div className="project-actions">
                          <button className="icon-btn" onClick={() => startEdit(project)} title="Edit project" type="button">
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-btn danger"
                            onClick={() => deleteProject(project.id)}
                            title="Delete project"
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {groupedSections.map(section => (
              <section key={section.key} className="projects-section-shell">
                <div className="projects-section-header">
                  <div>
                    <div className="projects-section-kicker">Job folder</div>
                    <h2>{section.label}</h2>
                    <p>{section.description}</p>
                  </div>

                  <div className="projects-section-summary">
                    <span>{section.projects.length} projects</span>
                    <span>Last activity {formatRelativeMillis(section.latestActivity)}</span>
                  </div>
                </div>

                <div className="projects-grid">
                  {section.projects.map(project => (
                    <article key={project.id} className={`project-card ${project.pinned ? 'is-pinned' : ''}`}>
                      <div className="project-card-topbar">
                        <div className="project-folder-pill">
                          <FolderOpen size={14} />
                          <span>{getFolderLabel(project.folderName)}</span>
                        </div>

                        <button
                          className={`project-pin-btn ${project.pinned ? 'active' : ''}`}
                          onClick={() => togglePinned(project)}
                          type="button"
                          title={project.pinned ? 'Unpin project' : 'Pin project'}
                          aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
                        >
                          <Star size={16} fill={project.pinned ? 'currentColor' : 'none'} />
                        </button>
                      </div>

                      <div className="project-top">
                        <div className="project-name" title={project.name}>
                          {project.name}
                        </div>
                        <div className="project-summary">{getProjectSummary(project)}</div>
                      </div>

                      <div className="project-badges">
                        {project.pinned ? <span className="project-badge accent">Pinned</span> : null}
                        {isActiveThisWeek(project) ? <span className="project-badge">Active this week</span> : null}
                      </div>

                      <div className="project-metrics">
                        <div className="project-metric">
                          <span>Updated</span>
                          <strong>{formatWhen(project.updatedAt)}</strong>
                        </div>
                        <div className="project-metric">
                          <span>Opened</span>
                          <strong>{formatWhen(project.lastOpenedAt)}</strong>
                        </div>
                        <div className="project-metric">
                          <span>Created</span>
                          <strong>{formatWhen(project.createdAt)}</strong>
                        </div>
                      </div>

                      <div className="project-bottom">
                        <button className="project-open" onClick={() => openProject(project.id)} type="button">
                          Open
                          <ArrowUpRight size={16} />
                        </button>

                        <div className="project-actions">
                          <button className="icon-btn" onClick={() => startEdit(project)} title="Edit project" type="button">
                            <Pencil size={16} />
                          </button>
                          <button
                            className="icon-btn danger"
                            onClick={() => deleteProject(project.id)}
                            title="Delete project"
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {createOpen ? (
        <div className="projects-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
          <form
            className="projects-modal"
            onSubmit={e => {
              e.preventDefault()
              void createProject()
            }}
          >
            <div className="modal-title" id="create-project-title">New project</div>

            <div className="modal-field">
              <label htmlFor="create-project-name">Project name</label>
              <input
                id="create-project-name"
                value={createDraft.name}
                onChange={e => setCreateDraft(prev => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="modal-field">
              <label htmlFor="create-project-folder">Job folder</label>
              <input
                id="create-project-folder"
                value={createDraft.folderName}
                onChange={e => setCreateDraft(prev => ({ ...prev, folderName: e.target.value }))}
                placeholder="Type a new folder or leave blank"
              />
              <div className="modal-helper">Assign this project to a job folder now, or file it later.</div>
              {folderOptions.length > 0 ? (
                <div className="modal-folder-chips">
                  {folderOptions.slice(0, 8).map(folder => (
                    <button
                      key={folder.key}
                      className={`modal-folder-chip ${normalizeText(createDraft.folderName).toLowerCase() === folder.key ? 'active' : ''}`}
                      onClick={() => setCreateDraft(prev => ({ ...prev, folderName: folder.label }))}
                      type="button"
                    >
                      {folder.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="modal-actions">
              <button className="projects-ghost" onClick={closeCreateModal} type="button">
                Cancel
              </button>
              <button className="projects-primary" type="submit">
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editId ? (
        <div className="projects-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-project-title">
          <form
            className="projects-modal"
            onSubmit={e => {
              e.preventDefault()
              void applyEdit()
            }}
          >
            <div className="modal-title" id="edit-project-title">Edit project</div>
            {editingProject ? <div className="modal-subtitle">{editingProject.name}</div> : null}

            <div className="modal-field">
              <label htmlFor="edit-project-name">Project name</label>
              <input
                id="edit-project-name"
                value={editDraft.name}
                onChange={e => setEditDraft(prev => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="modal-field">
              <label htmlFor="edit-project-folder">Job folder</label>
              <input
                id="edit-project-folder"
                value={editDraft.folderName}
                onChange={e => setEditDraft(prev => ({ ...prev, folderName: e.target.value }))}
                placeholder="Type a folder or leave blank"
              />
              <div className="modal-helper">Move this project into a folder, rename it, or clear the field to unfile it.</div>
              {folderOptions.length > 0 ? (
                <div className="modal-folder-chips">
                  {folderOptions.slice(0, 8).map(folder => (
                    <button
                      key={folder.key}
                      className={`modal-folder-chip ${normalizeText(editDraft.folderName).toLowerCase() === folder.key ? 'active' : ''}`}
                      onClick={() => setEditDraft(prev => ({ ...prev, folderName: folder.label }))}
                      type="button"
                    >
                      {folder.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="modal-actions">
              <button className="projects-ghost" onClick={closeEditModal} type="button">
                Cancel
              </button>
              <button className="projects-primary" type="submit">
                Save changes
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
