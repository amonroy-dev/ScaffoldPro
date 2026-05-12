import { useEffect, useRef, useState } from 'react'
import {
	doc,
	getDoc,
	serverTimestamp,
	updateDoc,
	writeBatch,
} from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from '../firebase'
import { useTool, type ProjectDataV1 } from '../contexts/ToolContext'
import { useProjectSession } from '../contexts/ProjectSessionContext'

type Props = {
  projectId: string
}

function getProjectDataSignature(data: ProjectDataV1): string {
	return JSON.stringify(data)
}

/**
 * Loads a project's persisted workspace state from Firestore and autosaves changes (debounced).
 * Render this inside ToolProvider.
 */
export function ProjectPersistence({ projectId }: Props) {
	  const { exportProjectData, loadProjectData } = useTool()
	  const projectDataSnapshot = exportProjectData()
	  const projectDataSignature = getProjectDataSignature(projectDataSnapshot)

  const [loadError, setLoadError] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [uid, setUid] = useState<string>('')

	const projectSession = useProjectSession()
	const setSaveStatus = projectSession?.setSaveStatus
		const setLastSavedAt = projectSession?.setLastSavedAt

	const [saveError, setSaveError] = useState<string>('')
		const [saveWarning, setSaveWarning] = useState<string>('')


	type DataMode = 'inline' | 'sharded'
	type ShardCounts = {
		scaffoldStacks: number
		ledgerConnections: number
		scaffoldBlocks: number
	}
		const DRAWING_PACKAGE_SHARD_ID = 'drawingPackage_0'
	const persistedRef = useRef<{ mode: DataMode; counts: ShardCounts }>({
		mode: 'inline',
		counts: { scaffoldStacks: 0, ledgerConnections: 0, scaffoldBlocks: 0 },
	})


  const saveTimerRef = useRef<number | null>(null)
  const skipNextSaveRef = useRef(true)
	const pendingSaveRef = useRef(false)
	const latestUidRef = useRef('')
	const latestLoadedRef = useRef(false)
	const latestProjectIdRef = useRef(projectId)
	const latestProjectDataRef = useRef(projectDataSnapshot)
	const latestLoadProjectDataRef = useRef(loadProjectData)
	const latestSetSaveStatusRef = useRef(setSaveStatus)
	const latestSetLastSavedAtRef = useRef(setLastSavedAt)
	const latestSaveProjectNowRef = useRef<((params: { uid: string; projectId: string; payload: ProjectDataV1 }) => Promise<void>) | null>(null)

	latestProjectDataRef.current = projectDataSnapshot

  useEffect(() => {
    // Be robust: even though the route guard usually guarantees auth is ready,
    // `auth.currentUser` can still be null momentarily on cold loads.
    const unsub = onAuthStateChanged(auth, u => {
      setUid(u?.uid ?? '')
    })
    return () => unsub()
  }, [])

	useEffect(() => {
		latestUidRef.current = uid
	}, [uid])

	useEffect(() => {
		latestLoadedRef.current = loaded
	}, [loaded])

	useEffect(() => {
		latestProjectIdRef.current = projectId
	}, [projectId])

	useEffect(() => {
		latestLoadProjectDataRef.current = loadProjectData
	}, [loadProjectData])

	useEffect(() => {
		latestSetSaveStatusRef.current = setSaveStatus
	}, [setSaveStatus])

	useEffect(() => {
		latestSetLastSavedAtRef.current = setLastSavedAt
	}, [setLastSavedAt])

	const estimateJsonBytes = (value: unknown): number => {
		try {
			const s = JSON.stringify(value)
			// Blob gives a better approximation of UTF-8 byte size than string.length.
			return new Blob([s]).size
		} catch {
			return Number.POSITIVE_INFINITY
		}
	}

	const chunkArrayByItemBytes = <T,>(items: T[], maxBytes: number): T[][] => {
		const out: T[][] = []
		let cur: T[] = []
		let curBytes = 0
		for (const item of items) {
			let itemBytes = 0
			try {
				itemBytes = new Blob([JSON.stringify(item)]).size
			} catch {
				itemBytes = maxBytes + 1
			}
			// If adding this item would exceed the chunk budget, flush current chunk.
			if (cur.length > 0 && curBytes + itemBytes > maxBytes) {
				out.push(cur)
				cur = []
				curBytes = 0
			}
			cur.push(item)
			curBytes += itemBytes
		}
		if (cur.length > 0) out.push(cur)
		return out
	}

	const readShardedPayload = async (params: {
		uid: string
		projectId: string
		base: Partial<ProjectDataV1>
		counts: ShardCounts
	}): Promise<ProjectDataV1> => {
		const { uid, projectId, base, counts } = params

		const readKind = async <T,>(kind: keyof ShardCounts): Promise<T[]> => {
			const n = Math.max(0, Number((counts as any)[kind] ?? 0))
			if (n === 0) return []
			const docs = await Promise.all(
				new Array(n).fill(0).map((_, i) => getDoc(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `${kind}_${i}`))),
			)
			const items: T[] = []
			for (const snap of docs) {
				const data: any = snap.exists() ? snap.data() : null
				const arr = Array.isArray(data?.items) ? (data.items as any[]) : []
				items.push(...(arr as T[]))
			}
			return items
		}

		const [stacks, conns, blocks] = await Promise.all([
			readKind<any>('scaffoldStacks'),
			readKind<any>('ledgerConnections'),
			readKind<any>('scaffoldBlocks'),
		])

		return {
			workspaceMode: (base.workspaceMode as any) ?? 'SCAFFOLD_MODE',
			objects: Array.isArray(base.objects) ? base.objects : [],
			scaffoldStacks: stacks as any,
			ledgerConnections: conns as any,
			...(Array.isArray((base as any).manualPlankPlacements) ? { manualPlankPlacements: (base as any).manualPlankPlacements } : {}),
			...(blocks.length > 0 ? { scaffoldBlocks: blocks as any } : {}),
			...(base?.drawingPackage ? { drawingPackage: base.drawingPackage } : {}),
			...(Array.isArray((base as any).scaffoldObjects) ? { scaffoldObjects: (base as any).scaffoldObjects } : {}),
		}
	}

		const readDrawingPackageShard = async (params: { uid: string; projectId: string }) => {
			try {
				const snap = await getDoc(doc(db, 'users', params.uid, 'projects', params.projectId, 'dataShards', DRAWING_PACKAGE_SHARD_ID))
				const data: any = snap.exists() ? snap.data() : null
				const items = Array.isArray(data?.items) ? data.items : []
				return items[0]
			} catch (e) {
				console.warn('[ProjectPersistence] drawing package shard read skipped:', e)
				return undefined
			}
		}

	const saveProjectNow = async (params: { uid: string; projectId: string; payload: ProjectDataV1 }) => {
		const { uid, projectId, payload } = params
			const { drawingPackage: drawingPackagePayload, ...mainPayload } = payload

		// Conservative thresholds to avoid approaching Firestore 1MiB doc limit.
		const INLINE_MAX_BYTES = 700_000
		const SHARD_MAX_BYTES = 450_000

			const totalBytes = estimateJsonBytes(payload)
		const mode: DataMode = totalBytes <= INLINE_MAX_BYTES ? 'inline' : 'sharded'
		const prev = persistedRef.current

		// Lightweight UI/console diagnostics (helps identify size vs other errors).
		console.log('[ProjectPersistence] autosave payload bytes:', totalBytes, 'mode:', mode)

		const mainRef = doc(db, 'users', uid, 'projects', projectId)

		if (mode === 'inline') {
				// Normalize to the legacy schema shape used at project creation time.
				// (Some rules validate that certain keys exist under `data`.)
				const payloadForRules: ProjectDataV1 = {
						...payload,
					// Keep key present (empty) to avoid payload bloat but satisfy strict schema rules.
						scaffoldObjects: Array.isArray((payload as any).scaffoldObjects) ? (payload as any).scaffoldObjects : [],
				}

				const writeInline = async (dataPayload: ProjectDataV1) => {
					// Many Firestore rulesets whitelist exact keys and/or only allow updates (not sets).
					const nestedPatch: Record<string, unknown> = {
						updatedAt: serverTimestamp(),
						'data.workspaceMode': dataPayload.workspaceMode,
						'data.objects': dataPayload.objects,
						'data.scaffoldObjects': (dataPayload as any).scaffoldObjects ?? [],
						'data.scaffoldStacks': dataPayload.scaffoldStacks,
						'data.ledgerConnections': dataPayload.ledgerConnections,
						...(Array.isArray((dataPayload as any).manualPlankPlacements)
							? { 'data.manualPlankPlacements': (dataPayload as any).manualPlankPlacements }
							: {}),
						...(Array.isArray((dataPayload as any).manualLiveLoadPlacements)
							? { 'data.manualLiveLoadPlacements': (dataPayload as any).manualLiveLoadPlacements }
							: {}),
						...((dataPayload as any).scaffoldBlocks ? { 'data.scaffoldBlocks': (dataPayload as any).scaffoldBlocks } : {}),
						...(dataPayload.drawingPackage ? { 'data.drawingPackage': dataPayload.drawingPackage } : {}),
					}

					const attempts: Array<Record<string, unknown>> = [
						// 1) Strict writeFields rules (some require schemaVersion to always be written)
						{ schemaVersion: 1, data: dataPayload, updatedAt: serverTimestamp() },
						// 2) Legacy inline autosave
						{ data: dataPayload, updatedAt: serverTimestamp() },
						// 3) Nested-field updates (+ schemaVersion)
						{ schemaVersion: 1, ...nestedPatch },
						// 4) Nested-field updates (no schemaVersion)
						nestedPatch,
					]

					let lastErr: any = null
					for (const patch of attempts) {
						try {
							await updateDoc(mainRef, patch as any)
							return
						} catch (e: any) {
							lastErr = e
							if ((e as any)?.code !== 'permission-denied') throw e
						}
					}
					throw lastErr
				}

				await writeInline(payloadForRules)
				setSaveWarning('')
			persistedRef.current = { mode: 'inline', counts: { scaffoldStacks: 0, ledgerConnections: 0, scaffoldBlocks: 0 } }
			return
		}

		// Sharded mode: store only a small base payload in the main doc and large arrays in subcollection shards.
		const batch = writeBatch(db)
			const stacks = Array.isArray(mainPayload.scaffoldStacks) ? mainPayload.scaffoldStacks : []
			const conns = Array.isArray(mainPayload.ledgerConnections) ? mainPayload.ledgerConnections : []
			const blocks = Array.isArray((mainPayload as any).scaffoldBlocks) ? ((mainPayload as any).scaffoldBlocks as any[]) : []

		const stackChunks = chunkArrayByItemBytes(stacks, SHARD_MAX_BYTES)
		const connChunks = chunkArrayByItemBytes(conns, SHARD_MAX_BYTES)
		const blockChunks = chunkArrayByItemBytes(blocks, SHARD_MAX_BYTES)

		const counts: ShardCounts = {
			scaffoldStacks: stackChunks.length,
			ledgerConnections: connChunks.length,
			scaffoldBlocks: blockChunks.length,
		}

		const baseData: Partial<ProjectDataV1> = {
				workspaceMode: mainPayload.workspaceMode,
				objects: mainPayload.objects,
				...(Array.isArray((payload as any).manualPlankPlacements)
					? { manualPlankPlacements: (payload as any).manualPlankPlacements }
					: {}),
				...(Array.isArray((payload as any).manualLiveLoadPlacements)
					? { manualLiveLoadPlacements: (payload as any).manualLiveLoadPlacements }
					: {}),
				...(drawingPackagePayload ? { drawingPackage: drawingPackagePayload } : {}),
				// Keep legacy key present to satisfy strict rulesets.
				scaffoldObjects: [],
		}

		batch.set(
			mainRef,
			{
				schemaVersion: 1,
				dataMode: 'sharded',
				data: baseData,
				dataShardCounts: counts,
				updatedAt: serverTimestamp(),
			},
			{ merge: true },
		)

		for (let i = 0; i < stackChunks.length; i++) {
			batch.set(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `scaffoldStacks_${i}`), {
				items: stackChunks[i],
			})
		}
		for (let i = 0; i < connChunks.length; i++) {
			batch.set(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `ledgerConnections_${i}`), {
				items: connChunks[i],
			})
		}
		for (let i = 0; i < blockChunks.length; i++) {
			batch.set(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `scaffoldBlocks_${i}`), {
				items: blockChunks[i],
			})
		}

		// Delete extra old shards if shrinking.
		if (prev.mode === 'sharded') {
			for (let i = counts.scaffoldStacks; i < (prev.counts.scaffoldStacks ?? 0); i++) {
				batch.delete(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `scaffoldStacks_${i}`))
			}
			for (let i = counts.ledgerConnections; i < (prev.counts.ledgerConnections ?? 0); i++) {
				batch.delete(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `ledgerConnections_${i}`))
			}
			for (let i = counts.scaffoldBlocks; i < (prev.counts.scaffoldBlocks ?? 0); i++) {
				batch.delete(doc(db, 'users', uid, 'projects', projectId, 'dataShards', `scaffoldBlocks_${i}`))
			}
		}

			await batch.commit()
		persistedRef.current = { mode: 'sharded', counts }
	}
	latestSaveProjectNowRef.current = saveProjectNow

  useEffect(() => {
    let cancelled = false
    if (!uid) return

    setLoaded(false)
    setLoadError('')
    skipNextSaveRef.current = true
		pendingSaveRef.current = false
		if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
			latestSetSaveStatusRef.current?.('idle')

    ;(async () => {
      try {
        const ref = doc(db, 'users', uid, 'projects', projectId)
        const snap = await getDoc(ref)

        if (!snap.exists()) {
          throw new Error('Project not found')
        }

	        const data = snap.data() as any
				const mode: DataMode = data?.dataMode === 'sharded' ? 'sharded' : 'inline'
				const counts: ShardCounts = {
					scaffoldStacks: Math.max(0, Number(data?.dataShardCounts?.scaffoldStacks ?? 0)),
					ledgerConnections: Math.max(0, Number(data?.dataShardCounts?.ledgerConnections ?? 0)),
					scaffoldBlocks: Math.max(0, Number(data?.dataShardCounts?.scaffoldBlocks ?? 0)),
				}

				let payload: ProjectDataV1 | undefined = data?.data
				if (mode === 'sharded') {
					payload = await readShardedPayload({ uid, projectId, base: (data?.data ?? {}) as any, counts })
				}
				if (payload && !payload.drawingPackage) {
					const drawingPackage = await readDrawingPackageShard({ uid, projectId })
					if (drawingPackage) {
						payload = { ...payload, drawingPackage }
					}
				}

				persistedRef.current = { mode, counts: mode === 'sharded' ? counts : { scaffoldStacks: 0, ledgerConnections: 0, scaffoldBlocks: 0 } }

	        if (payload && typeof payload === 'object') {
					latestLoadProjectDataRef.current(payload)
	        }

        if (!cancelled) setLoaded(true)
      } catch (e: any) {
        console.error('[ProjectPersistence] load error:', e)
        if (!cancelled) {
          setLoadError(e?.message ?? 'Failed to load project')
          setLoaded(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
		}, [projectId, uid])

	// On unmount: if a debounced save is pending, flush it immediately so navigation doesn't lose work.
	useEffect(() => {
		return () => {
			const uidNow = latestUidRef.current
			const projectIdNow = latestProjectIdRef.current
			if (!uidNow) return
			if (!latestLoadedRef.current) return
			if (!pendingSaveRef.current) return
			if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)

			void (async () => {
				try {
						const payload = latestProjectDataRef.current
						await latestSaveProjectNowRef.current?.({ uid: uidNow, projectId: projectIdNow, payload })
				} catch (e) {
					console.warn('[ProjectPersistence] flush save failed:', e)
				}
			})()
		}
	}, [])

  useEffect(() => {
    if (!uid) return
    if (!loaded) return

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
		pendingSaveRef.current = true
			latestSetSaveStatusRef.current?.('saving')

    saveTimerRef.current = window.setTimeout(async () => {
      try {
			        const payload = latestProjectDataRef.current
					await latestSaveProjectNowRef.current?.({ uid, projectId, payload })
				pendingSaveRef.current = false
						latestSetSaveStatusRef.current?.('saved')
						setSaveError('')
					// Immediate local timestamp for UX; Firestore `updatedAt` will reconcile via onSnapshot.
						latestSetLastSavedAtRef.current?.(new Date())
      } catch (e) {
        // Non-blocking: we don't want autosave failures to crash the editor.
        console.warn('[ProjectPersistence] autosave failed:', e)
				pendingSaveRef.current = false
					latestSetSaveStatusRef.current?.('error')
					const msg =
						(typeof (e as any)?.message === 'string' && (e as any).message.length > 0
							? (e as any).message
							: 'Autosave failed') +
						(typeof (e as any)?.code === 'string' ? ` (code: ${(e as any).code})` : '')
					setSaveError(msg)
      }
    }, 800)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
	}, [
    loaded,
    projectId,
    uid,
			projectDataSignature,
  ])

	  // Minimal, unobtrusive error surface (console already logs). You can enhance this into a toast later.
		  if (loadError || saveError || saveWarning) {
    return (
      <div
        style={{
          position: 'fixed',
          left: 12,
          bottom: 12,
          zIndex: 250,
          padding: '10px 12px',
          borderRadius: 12,
	          border: saveError || loadError ? '1px solid rgba(255, 99, 132, 0.28)' : '1px solid rgba(250, 204, 21, 0.35)',
	          background: saveError || loadError ? 'rgba(255, 99, 132, 0.10)' : 'rgba(250, 204, 21, 0.10)',
          color: 'rgba(255,255,255,0.92)',
          fontSize: 12,
          maxWidth: 420,
        }}
      >
		        {loadError || saveError || saveWarning}
      </div>
    )
  }

  return null
}
