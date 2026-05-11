import type { User } from 'firebase/auth'
import {
  Timestamp,
  addDoc,
  collection,
  collectionGroup,
  doc,
  type DocumentReference,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { createDefaultDrawingPackage } from '../../drawings/drawingDocument'
import { db } from '../../firebase'
import type { PmActivityEvent, PmComment, PmHomeData, PmJob, PmMember, PmStage, PmSubtask, PmTask, PmTaskPriority } from '../types'
import { canArchiveTask } from '../utils/archive'
import { getMidpointSortKey } from '../utils/sortKey'

const DEFAULT_STAGE_DEFS = [
  { id: 'intake', name: 'Backlog', colorToken: 'slate' },
  { id: 'engineering', name: 'To do', colorToken: 'amber' },
  { id: 'approval', name: 'In progress', colorToken: 'blue' },
  { id: 'fabrication', name: 'Review', colorToken: 'purple' },
  { id: 'complete', name: 'Done', colorToken: 'green', isClosedStage: true },
] as const

function getDisplayName(user: User) {
  return user.displayName?.trim() || user.email?.split('@')[0] || 'ScaffoldPro User'
}

function createEmptyLegacyProjectData() {
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

function mapDoc<T>(id: string, data: any) {
  return { id, ...(data ?? {}) } as T
}

function mapPmJobDoc(id: string, data: any) {
  const job = mapDoc<PmJob>(id, data)
  return {
    ...job,
    status: job.status ?? (job.archivedAt ? 'archived' : job.stageId === 'complete' ? 'completed' : 'active'),
    archivedAt: job.archivedAt ?? null,
    archivedBy: job.archivedBy ?? null,
  } as PmJob
}

function mapPmTaskDoc(id: string, data: any) {
  const task = mapDoc<PmTask>(id, data)
  return {
    ...task,
    description: task.description ?? '',
    assigneeUid: task.assigneeUid ?? null,
    dueDate: task.dueDate ?? null,
    completedAt: task.completedAt ?? null,
    isArchived: task.isArchived ?? false,
    archivedAt: task.archivedAt ?? null,
    archivedBy: task.archivedBy ?? null,
    subtaskCount: task.subtaskCount ?? 0,
    commentCount: task.commentCount ?? 0,
  } as PmTask
}

export function getDefaultPmOrgId(uid: string) {
  return `org_${uid}`
}

export async function ensureDefaultPmOrg(user: User) {
  const orgId = getDefaultPmOrgId(user.uid)
  const orgRef = doc(db, 'orgs', orgId)
  const memberRef = doc(db, 'orgs', orgId, 'members', user.uid)
  const [orgSnap, memberSnap] = await Promise.all([getDoc(orgRef), getDoc(memberRef)])

  const batch = writeBatch(db)
  if (!orgSnap.exists()) {
    batch.set(orgRef, {
      name: `${getDisplayName(user)} Workspace`,
      slug: orgId,
      personal: true,
      createdBy: user.uid,
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
  if (!memberSnap.exists()) {
    batch.set(memberRef, {
      uid: user.uid,
      displayName: getDisplayName(user),
      email: user.email ?? '',
      role: 'owner',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
  if (!orgSnap.exists() || !memberSnap.exists()) {
    await batch.commit()
  }
  return orgId
}

export function listenPmOrgMembers(orgId: string, callback: (members: PmMember[]) => void) {
  return onSnapshot(collection(db, 'orgs', orgId, 'members'), snap => {
    const items = snap.docs
      .map(member => mapDoc<PmMember>(member.id, member.data()))
      .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email))
    callback(items)
  })
}

export async function createPmJob(params: {
  user: User
  orgId: string
  title: string
  customer?: string
  siteAddress?: string
}) {
  const { user, orgId, title, customer = '', siteAddress = '' } = params
  const batch = writeBatch(db)
  const legacyProjectRef = doc(collection(db, 'users', user.uid, 'projects'))
  const jobRef = doc(collection(db, 'jobs'))

  batch.set(legacyProjectRef, {
    name: title,
    pinned: false,
    folderName: 'PM Jobs',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastOpenedAt: serverTimestamp(),
    ...createEmptyLegacyProjectData(),
  })

  batch.set(jobRef, {
    orgId,
    title,
    customer,
    siteAddress,
    stageId: DEFAULT_STAGE_DEFS[0].id,
    status: 'active',
    keyDates: {},
    latestDesignRevId: legacyProjectRef.id,
    archivedAt: null,
    archivedBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
    updatedBy: user.uid,
  })

  DEFAULT_STAGE_DEFS.forEach((stage, index) => {
    batch.set(doc(db, 'jobs', jobRef.id, 'stages', stage.id), {
      name: stage.name,
      order: index,
      colorToken: stage.colorToken,
      ...('isClosedStage' in stage && stage.isClosedStage ? { isClosedStage: true } : {}),
    })
  })

  await batch.commit()
  return jobRef.id
}

export async function createPmStage(params: { jobId: string; name: string; user: User; nextOrder: number }) {
  const stageRef = doc(collection(db, 'jobs', params.jobId, 'stages'))
  await setDoc(stageRef, {
    name: params.name,
    order: params.nextOrder,
    colorToken: 'slate',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.user.uid,
    updatedBy: params.user.uid,
  })
}

export function listenPmJobs(orgId: string, callback: (jobs: PmJob[]) => void) {
  return onSnapshot(query(collection(db, 'jobs'), where('orgId', '==', orgId), orderBy('updatedAt', 'desc')), snap => {
    callback(snap.docs.map(job => mapPmJobDoc(job.id, job.data())))
  })
}

export function listenPmJob(jobId: string, callback: (job: PmJob | null) => void) {
  return onSnapshot(doc(db, 'jobs', jobId), snap => {
    callback(snap.exists() ? mapPmJobDoc(snap.id, snap.data()) : null)
  })
}

export function listenPmStages(jobId: string, callback: (stages: PmStage[]) => void) {
  return onSnapshot(query(collection(db, 'jobs', jobId, 'stages'), orderBy('order', 'asc')), snap => {
    callback(snap.docs.map(stage => mapDoc<PmStage>(stage.id, stage.data())))
  })
}

export function listenPmTasks(jobId: string, callback: (tasks: PmTask[]) => void) {
  return onSnapshot(query(collection(db, 'jobs', jobId, 'tasks'), orderBy('stageId', 'asc'), orderBy('sortKey', 'asc')), snap => {
    callback(snap.docs.map(task => mapPmTaskDoc(task.id, task.data())))
  })
}

async function writeTaskActivity(jobId: string, taskId: string, actorUid: string, type: string, payloadSmall?: Record<string, unknown>) {
  await addDoc(collection(db, 'jobs', jobId, 'tasks', taskId, 'activity'), {
    type,
    actorUid,
    payloadSmall: payloadSmall ?? {},
    createdAt: serverTimestamp(),
  })
}

async function writeJobActivity(jobId: string, actorUid: string, type: string, payloadSmall?: Record<string, unknown>) {
  await addDoc(collection(db, 'jobs', jobId, 'activity'), {
    type,
    actorUid,
    payloadSmall: payloadSmall ?? {},
    createdAt: serverTimestamp(),
  })
}

async function listPmTasksForPlacement(jobId: string) {
  const snap = await getDocs(query(collection(db, 'jobs', jobId, 'tasks'), orderBy('stageId', 'asc'), orderBy('sortKey', 'asc')))
  return snap.docs.map(taskDoc => mapPmTaskDoc(taskDoc.id, taskDoc.data()))
}

function getRelatedTaskSortKey(tasks: PmTask[], sourceTask: PmTask) {
  const activeStageTasks = tasks
    .filter(task => task.stageId === sourceTask.stageId && !task.isArchived)
    .sort((left, right) => left.sortKey - right.sortKey)

  if (!sourceTask.isArchived) {
    const sourceIndex = activeStageTasks.findIndex(task => task.id === sourceTask.id)
    if (sourceIndex >= 0) {
      return getMidpointSortKey(activeStageTasks[sourceIndex]?.sortKey ?? null, activeStageTasks[sourceIndex + 1]?.sortKey ?? null)
    }
  }

  return getMidpointSortKey(activeStageTasks[activeStageTasks.length - 1]?.sortKey ?? null, null)
}

async function deleteRefsInChunks(refs: DocumentReference[]) {
  for (let index = 0; index < refs.length; index += 400) {
    const batch = writeBatch(db)
    refs.slice(index, index + 400).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
}

function getTomorrowAtNoon() {
  const next = new Date()
  next.setHours(12, 0, 0, 0)
  next.setDate(next.getDate() + 1)
  return next
}

export async function createPmTask(params: {
  jobId: string
  orgId: string
  stageId: string
  title: string
  user: User
  assigneeUid?: string | null
  priority?: PmTaskPriority
  sortKeyBefore?: number | null
  sortKeyAfter?: number | null
}) {
  const title = params.title.trim() || 'Untitled task'
  const taskRef = doc(collection(db, 'jobs', params.jobId, 'tasks'))
  await setDoc(taskRef, {
    orgId: params.orgId,
    jobId: params.jobId,
    title,
    description: '',
    stageId: params.stageId,
    assigneeUid: params.assigneeUid ?? null,
    dueDate: null,
    priority: params.priority ?? 'normal',
    completedAt: null,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    sortKey: getMidpointSortKey(params.sortKeyBefore, params.sortKeyAfter),
    groupKey: params.assigneeUid ?? 'unassigned',
    subtaskCount: 0,
    commentCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: params.user.uid,
    updatedBy: params.user.uid,
  })
  await writeTaskActivity(params.jobId, taskRef.id, params.user.uid, 'task.created', { title })
  return taskRef.id
}

export async function movePmTask(params: {
  jobId: string
  taskId: string
  stageId: string
  sortKey: number
  groupKey?: string | null
  user: User
}) {
  await updateDoc(doc(db, 'jobs', params.jobId, 'tasks', params.taskId), {
    stageId: params.stageId,
    sortKey: params.sortKey,
    ...(params.groupKey !== undefined ? { groupKey: params.groupKey } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: params.user.uid,
  })
  await writeTaskActivity(params.jobId, params.taskId, params.user.uid, 'task.stage_changed', { stageId: params.stageId })
}

export async function renamePmTask(jobId: string, taskId: string, title: string, user: User) {
  const nextTitle = title.trim() || 'Untitled task'
  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId), {
    title: nextTitle,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await writeTaskActivity(jobId, taskId, user.uid, 'task.title_changed', { title: nextTitle })
}

export async function updatePmTaskDescription(jobId: string, taskId: string, description: string, user: User) {
  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId), {
    description,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await writeTaskActivity(jobId, taskId, user.uid, 'task.description_changed')
}

export async function updatePmTaskDueDate(
  jobId: string,
  taskId: string,
  dueDate: Date | null,
  user: User,
  previousDueDate?: Timestamp | Date | string | null,
) {
  const previousDate = previousDueDate instanceof Date
    ? previousDueDate
    : typeof previousDueDate === 'string'
      ? new Date(previousDueDate)
      : typeof previousDueDate?.toDate === 'function'
        ? previousDueDate.toDate()
        : null
  const previousValue = previousDate && !Number.isNaN(previousDate.getTime())
    ? previousDate.toISOString().slice(0, 10)
    : ''
  const nextValue = dueDate ? dueDate.toISOString().slice(0, 10) : ''

  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId), {
    dueDate: dueDate ? Timestamp.fromDate(dueDate) : null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  if (previousValue === nextValue) return

  const eventType = !previousValue && nextValue
    ? 'task.due_date_set'
    : previousValue && !nextValue
      ? 'task.due_date_cleared'
      : 'task.due_date_changed'
  await writeTaskActivity(jobId, taskId, user.uid, eventType, { dueDate: dueDate?.toISOString() ?? null })
}

export async function updatePmTaskAssignee(jobId: string, taskId: string, assigneeUid: string | null, user: User) {
  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId), {
    assigneeUid,
    groupKey: assigneeUid ?? 'unassigned',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await writeTaskActivity(jobId, taskId, user.uid, 'task.assignee_changed', { assigneeUid })
}

export async function updatePmTaskPriority(jobId: string, taskId: string, priority: PmTaskPriority, user: User) {
  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId), {
    priority,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

export async function togglePmTaskComplete(jobId: string, taskId: string, completed: boolean, user: User) {
  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId), {
    completedAt: completed ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await writeTaskActivity(jobId, taskId, user.uid, completed ? 'task.completed' : 'task.reopened')
}

export function listenPmTask(jobId: string, taskId: string, callback: (task: PmTask | null) => void) {
  return onSnapshot(doc(db, 'jobs', jobId, 'tasks', taskId), snap => {
    callback(snap.exists() ? mapPmTaskDoc(snap.id, snap.data()) : null)
  })
}

export function listenPmSubtasks(jobId: string, taskId: string, callback: (subtasks: PmSubtask[]) => void) {
  return onSnapshot(query(collection(db, 'jobs', jobId, 'tasks', taskId, 'subtasks'), orderBy('sortKey', 'asc')), snap => {
    callback(snap.docs.map(subtask => mapDoc<PmSubtask>(subtask.id, subtask.data())))
  })
}

export async function addPmSubtask(jobId: string, taskId: string, title: string, user: User, sortKeyAfter?: number | null) {
  const subtaskRef = doc(collection(db, 'jobs', jobId, 'tasks', taskId, 'subtasks'))
  const batch = writeBatch(db)
  batch.set(subtaskRef, {
    title: title.trim() || 'Untitled subtask',
    completed: false,
    sortKey: getMidpointSortKey(sortKeyAfter, null),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
    updatedBy: user.uid,
  })
  batch.update(doc(db, 'jobs', jobId, 'tasks', taskId), {
    subtaskCount: increment(1),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await batch.commit()
  await writeTaskActivity(jobId, taskId, user.uid, 'task.subtask_added', { title })
}

export async function duplicatePmTask(task: PmTask, user: User) {
  const [tasks, subtasksSnap] = await Promise.all([
    listPmTasksForPlacement(task.jobId),
    getDocs(query(collection(db, 'jobs', task.jobId, 'tasks', task.id, 'subtasks'), orderBy('sortKey', 'asc'))),
  ])

  const nextTaskRef = doc(collection(db, 'jobs', task.jobId, 'tasks'))
  const nextTitle = `Copy of ${task.title.trim() || 'Untitled task'}`
  const batch = writeBatch(db)

  batch.set(nextTaskRef, {
    orgId: task.orgId,
    jobId: task.jobId,
    title: nextTitle,
    description: task.description ?? '',
    stageId: task.stageId,
    assigneeUid: task.assigneeUid ?? null,
    dueDate: task.dueDate ?? null,
    priority: task.priority,
    completedAt: null,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    sortKey: getRelatedTaskSortKey(tasks, task),
    groupKey: task.assigneeUid ?? 'unassigned',
    subtaskCount: subtasksSnap.size,
    commentCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
    updatedBy: user.uid,
  })

  subtasksSnap.docs.forEach(subtaskDoc => {
    const subtask = mapDoc<PmSubtask>(subtaskDoc.id, subtaskDoc.data())
    batch.set(doc(collection(db, 'jobs', task.jobId, 'tasks', nextTaskRef.id, 'subtasks')), {
      title: subtask.title,
      completed: subtask.completed,
      sortKey: subtask.sortKey,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
      updatedBy: user.uid,
    })
  })

  batch.set(doc(collection(db, 'jobs', task.jobId, 'tasks', nextTaskRef.id, 'activity')), {
    actorUid: user.uid,
    type: 'task.created',
    payloadSmall: { title: nextTitle },
    createdAt: serverTimestamp(),
  })
  batch.set(doc(collection(db, 'jobs', task.jobId, 'tasks', nextTaskRef.id, 'activity')), {
    actorUid: user.uid,
    type: 'task.duplicated',
    payloadSmall: { sourceTaskId: task.id, sourceTitle: task.title },
    createdAt: serverTimestamp(),
  })

  await batch.commit()
  return nextTaskRef.id
}

export async function createFollowUpTask(task: PmTask, user: User) {
  const tasks = await listPmTasksForPlacement(task.jobId)
  const followUpRef = doc(collection(db, 'jobs', task.jobId, 'tasks'))
  const title = `Follow up on: ${task.title.trim() || 'Untitled task'}`
  const batch = writeBatch(db)

  batch.set(followUpRef, {
    orgId: task.orgId,
    jobId: task.jobId,
    title,
    description: task.description ?? '',
    stageId: task.stageId,
    assigneeUid: task.assigneeUid ?? null,
    dueDate: Timestamp.fromDate(getTomorrowAtNoon()),
    priority: task.priority,
    completedAt: null,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    sortKey: getRelatedTaskSortKey(tasks, task),
    groupKey: task.assigneeUid ?? 'unassigned',
    subtaskCount: 0,
    commentCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
    updatedBy: user.uid,
  })

  batch.set(doc(collection(db, 'jobs', task.jobId, 'tasks', followUpRef.id, 'activity')), {
    actorUid: user.uid,
    type: 'task.created',
    payloadSmall: { title },
    createdAt: serverTimestamp(),
  })
  batch.set(doc(collection(db, 'jobs', task.jobId, 'tasks', followUpRef.id, 'activity')), {
    actorUid: user.uid,
    type: 'task.follow_up_created',
    payloadSmall: { sourceTaskId: task.id, sourceTitle: task.title },
    createdAt: serverTimestamp(),
  })

  await batch.commit()
  return followUpRef.id
}

export async function deletePmTask(jobId: string, taskId: string, user: User) {
  const taskRef = doc(db, 'jobs', jobId, 'tasks', taskId)
  const [taskSnap, subtasksSnap, commentsSnap, activitySnap] = await Promise.all([
    getDoc(taskRef),
    getDocs(collection(db, 'jobs', jobId, 'tasks', taskId, 'subtasks')),
    getDocs(collection(db, 'jobs', jobId, 'tasks', taskId, 'comments')),
    getDocs(collection(db, 'jobs', jobId, 'tasks', taskId, 'activity')),
  ])

  await deleteRefsInChunks([
    ...subtasksSnap.docs.map(docSnap => docSnap.ref),
    ...commentsSnap.docs.map(docSnap => docSnap.ref),
    ...activitySnap.docs.map(docSnap => docSnap.ref),
    taskRef,
  ])

  await writeJobActivity(jobId, user.uid, 'task.deleted', {
    taskId,
    title: taskSnap.data()?.title ?? null,
  })
}

export async function updatePmSubtask(jobId: string, taskId: string, subtaskId: string, patch: Partial<PmSubtask>, user: User) {
  await updateDoc(doc(db, 'jobs', jobId, 'tasks', taskId, 'subtasks', subtaskId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  if (typeof patch.completed === 'boolean') {
    await writeTaskActivity(jobId, taskId, user.uid, patch.completed ? 'task.subtask_completed' : 'task.subtask_uncompleted')
    return
  }
  if (patch.title) {
    await writeTaskActivity(jobId, taskId, user.uid, 'task.subtask_changed', { title: patch.title })
  }
}

export async function archiveTask(params: { jobId: string; task: PmTask; user: User; canArchive?: boolean }) {
  const { jobId, task, user, canArchive: allowArchive = true } = params
  if (task.isArchived || !allowArchive) return false

  const batch = writeBatch(db)
  batch.update(doc(db, 'jobs', jobId, 'tasks', task.id), {
    isArchived: true,
    archivedAt: serverTimestamp(),
    archivedBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  batch.set(doc(collection(db, 'jobs', jobId, 'tasks', task.id, 'activity')), {
    actorUid: user.uid,
    type: 'task.archived',
    payloadSmall: {},
    createdAt: serverTimestamp(),
  })
  await batch.commit()
  return true
}

export async function restoreTask(jobId: string, taskId: string, user: User) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'jobs', jobId, 'tasks', taskId), {
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  batch.set(doc(collection(db, 'jobs', jobId, 'tasks', taskId, 'activity')), {
    actorUid: user.uid,
    type: 'task.restored',
    payloadSmall: {},
    createdAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function bulkArchiveDoneTasks(params: { jobId: string; tasks: PmTask[]; stages: PmStage[]; user: User }) {
  const stagesById = Object.fromEntries(params.stages.map(stage => [stage.id, stage]))
  const eligibleTasks = params.tasks.filter(task => canArchiveTask(task, stagesById[task.stageId]))
  if (!eligibleTasks.length) return 0

  const batch = writeBatch(db)
  eligibleTasks.forEach(task => {
    batch.update(doc(db, 'jobs', params.jobId, 'tasks', task.id), {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: params.user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: params.user.uid,
    })
    batch.set(doc(collection(db, 'jobs', params.jobId, 'tasks', task.id, 'activity')), {
      actorUid: params.user.uid,
      type: 'task.archived',
      payloadSmall: { bulk: true },
      createdAt: serverTimestamp(),
    })
  })

  await batch.commit()
  return eligibleTasks.length
}

export async function archivePmJob(job: PmJob, user: User) {
  if (job.status === 'archived') return

  await updateDoc(doc(db, 'jobs', job.id), {
    status: 'archived',
    archivedAt: serverTimestamp(),
    archivedBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await writeJobActivity(job.id, user.uid, 'job.archived')
}

export async function restorePmJob(job: PmJob, user: User) {
  await updateDoc(doc(db, 'jobs', job.id), {
    status: job.stageId === 'complete' ? 'completed' : 'active',
    archivedAt: null,
    archivedBy: null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await writeJobActivity(job.id, user.uid, 'job.restored')
}

export function listenPmComments(jobId: string, taskId: string, callback: (comments: PmComment[]) => void) {
  return onSnapshot(query(collection(db, 'jobs', jobId, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc')), snap => {
    callback(snap.docs.map(comment => mapDoc<PmComment>(comment.id, comment.data())))
  })
}

export async function addPmComment(jobId: string, taskId: string, body: string, user: User) {
  const batch = writeBatch(db)
  batch.set(doc(collection(db, 'jobs', jobId, 'tasks', taskId, 'comments')), {
    authorUid: user.uid,
    body,
    createdAt: serverTimestamp(),
  })
  batch.update(doc(db, 'jobs', jobId, 'tasks', taskId), {
    commentCount: increment(1),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  await batch.commit()
  await writeTaskActivity(jobId, taskId, user.uid, 'task.comment_added')
}

export function listenPmActivity(jobId: string, taskId: string, callback: (events: PmActivityEvent[]) => void) {
  return onSnapshot(query(collection(db, 'jobs', jobId, 'tasks', taskId, 'activity'), orderBy('createdAt', 'desc'), limit(25)), snap => {
    callback(snap.docs.map(event => mapDoc<PmActivityEvent>(event.id, event.data())))
  })
}

export function listenPmAssignedTasks(orgId: string, uid: string, callback: (tasks: PmTask[]) => void) {
  return onSnapshot(
    query(collectionGroup(db, 'tasks'), where('orgId', '==', orgId), where('assigneeUid', '==', uid), orderBy('updatedAt', 'desc'), limit(60)),
    snap => callback(snap.docs.map(task => mapPmTaskDoc(task.id, task.data()))),
  )
}

export async function fetchPmHomeData(orgId: string, uid: string): Promise<PmHomeData> {
  const [jobsSnap, tasksSnap] = await Promise.all([
    getDocs(query(collection(db, 'jobs'), where('orgId', '==', orgId), orderBy('updatedAt', 'desc'), limit(8))),
    getDocs(query(collectionGroup(db, 'tasks'), where('orgId', '==', orgId), where('assigneeUid', '==', uid), orderBy('updatedAt', 'desc'), limit(40))),
  ])

  const recentJobs = jobsSnap.docs
    .map(job => mapPmJobDoc(job.id, job.data()))
    .filter(job => job.status !== 'archived')
  const tasks = tasksSnap.docs
    .map(task => mapPmTaskDoc(task.id, task.data()))
    .filter(task => !task.isArchived)
  const today = new Date()

  const overdue = tasks.filter(task => {
    const dueDate = task.dueDate?.toDate?.()
    return dueDate && dueDate.getTime() < today.getTime() && !task.completedAt
  }).slice(0, 6)

  const dueSoon = tasks.filter(task => {
    const dueDate = task.dueDate?.toDate?.()
    return dueDate && dueDate.getTime() >= today.getTime() && dueDate.getTime() <= today.getTime() + 1000 * 60 * 60 * 24 * 7 && !task.completedAt
  }).slice(0, 6)

  const counts = new Map<string, number>()
  recentJobs.forEach(job => counts.set(job.stageId, (counts.get(job.stageId) ?? 0) + 1))

  const upcomingDeliveries = recentJobs.filter(job => Boolean(job.keyDates?.deliveryDate)).slice(0, 4)

  return {
    dueSoon,
    overdue,
    recentJobs,
    jobsByStage: Array.from(counts.entries()).map(([stageId, count]) => ({ stageId, count })),
    upcomingDeliveries,
  }
}
