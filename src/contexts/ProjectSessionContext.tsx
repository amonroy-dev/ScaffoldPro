import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'

export type ProjectSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type ProjectSessionValue = {
  projectId: string
  projectName: string
  saveStatus: ProjectSaveStatus
  setSaveStatus: (status: ProjectSaveStatus) => void

	/**
	 * Last confirmed save time (usually derived from the project's Firestore `updatedAt`).
	 * Used for professional “Saved • 12:41 PM” UX.
	 */
	lastSavedAt: Date | null
	setLastSavedAt: (date: Date | null) => void
}

const ProjectSessionContext = createContext<ProjectSessionValue | null>(null)

export function ProjectSessionProvider({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const [uid, setUid] = useState('')
  const [projectName, setProjectName] = useState('Untitled project')
  const [saveStatus, setSaveStatus] = useState<ProjectSaveStatus>('idle')
	const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    // Robust on cold loads.
    const unsub = onAuthStateChanged(auth, u => setUid(u?.uid ?? ''))
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!uid) return

    const ref = doc(db, 'users', uid, 'projects', projectId)
		const unsub = onSnapshot(
      ref,
      snap => {
				const data = snap.exists() ? (snap.data() as any) : null
				const name = data?.name
				const normalized = typeof name === 'string' ? name.trim() : ''
				setProjectName(normalized || 'Untitled project')

				// Track last saved time (from Firestore). `updatedAt` is a Timestamp.
				const updatedAt = data?.updatedAt
				const updatedDate: Date | null =
					updatedAt && typeof updatedAt?.toDate === 'function' ? updatedAt.toDate() : null
				if (updatedDate) setLastSavedAt(updatedDate)
      },
      err => {
        console.warn('[ProjectSession] name listener error:', err)
      },
    )

    return () => unsub()
  }, [projectId, uid])

	const value = useMemo<ProjectSessionValue>(
		() => ({
			projectId,
			projectName,
			saveStatus,
			setSaveStatus,
			lastSavedAt,
			setLastSavedAt,
		}),
		[projectId, projectName, saveStatus, lastSavedAt],
	)

  return <ProjectSessionContext.Provider value={value}>{children}</ProjectSessionContext.Provider>
}

/**
 * Returns null if used outside a ProjectSessionProvider.
 * (Keeps the editor usable in non-project contexts.)
 */
export function useProjectSession() {
  return useContext(ProjectSessionContext)
}

