import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, doc, writeBatch } from 'firebase/firestore'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-scaffoldpro'
const DEMO_EMAIL = process.env.PM_E2E_EMAIL || 'pm-demo@scaffoldpro.test'
const DEMO_PASSWORD = process.env.PM_E2E_PASSWORD || 'Password123!'
const COLLAB_EMAIL = process.env.PM_E2E_COLLAB_EMAIL || 'pm-collab@scaffoldpro.test'
const COLLAB_PASSWORD = process.env.PM_E2E_COLLAB_PASSWORD || 'Password123!'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082'
const [firestoreHostname, firestorePortRaw] = firestoreHost.split(':')
const firestorePort = Number(firestorePortRaw || '8082')
const authBaseUrl = authHost.startsWith('http') ? authHost : `http://${authHost}`

function createEmptyLegacyProjectData() {
  return {
    schemaVersion: 1,
    data: {
      workspaceMode: 'BUILDING_MODE',
      objects: [],
      scaffoldObjects: [],
      scaffoldStacks: [],
      ledgerConnections: [],
      manualPlankPlacements: [],
      scaffoldBlocks: [],
      drawingPackage: {
        version: 1,
        sheets: [],
      },
    },
  }
}

function dateAtLocalNoon(offsetDays = 0) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date
}

async function waitForHttp(url, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`)
}

async function authRequest(endpoint, body) {
  const response = await fetch(`${authBaseUrl}/identitytoolkit.googleapis.com/v1/${endpoint}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) {
    const code = payload?.error?.message || 'AUTH_REQUEST_FAILED'
    throw new Error(code)
  }
  return payload
}

async function ensureAuthUser({ email, password, displayName }) {
  try {
    const created = await authRequest('accounts:signUp', { email, password, returnSecureToken: true })
    await authRequest('accounts:update', { idToken: created.idToken, displayName, returnSecureToken: false })
    return { uid: created.localId }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'EMAIL_EXISTS') throw error
    const signedIn = await authRequest('accounts:signInWithPassword', { email, password, returnSecureToken: true })
    await authRequest('accounts:update', { idToken: signedIn.idToken, displayName, returnSecureToken: false })
    return { uid: signedIn.localId }
  }
}

const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')

await waitForHttp(`${authBaseUrl}/`, 'Auth emulator')
await waitForHttp(`http://${firestoreHost}/`, 'Firestore emulator')

const owner = await ensureAuthUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'PM Demo User' })
const collaborator = await ensureAuthUser({ email: COLLAB_EMAIL, password: COLLAB_PASSWORD, displayName: 'PM Collaborator' })
const orgId = `org_${owner.uid}`
const jobId = 'seed_job_harbor_tower'
const legacyProjectId = 'seed_design_harbor_tower'
const dueSoonDate = Timestamp.fromDate(dateAtLocalNoon(2))
const overdueDate = Timestamp.fromDate(dateAtLocalNoon(-2))
const todayDate = Timestamp.fromDate(dateAtLocalNoon(0))
const tomorrowDate = Timestamp.fromDate(dateAtLocalNoon(1))
const weekdayDate = Timestamp.fromDate(dateAtLocalNoon(4))
const now = Timestamp.now()

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    host: firestoreHostname,
    port: firestorePort,
    rules,
  },
})

await testEnv.clearFirestore()

await testEnv.withSecurityRulesDisabled(async context => {
  const db = context.firestore()
  const batch = writeBatch(db)

  batch.set(doc(db, 'accessAllowlist', owner.uid), { active: true, approvedBy: 'system', approvedAt: now })
  batch.set(doc(db, 'accessAllowlist', collaborator.uid), { active: true, approvedBy: 'system', approvedAt: now })

  batch.set(doc(db, 'orgs', orgId), {
    name: 'PM Demo User Workspace',
    slug: orgId,
    personal: true,
    createdBy: owner.uid,
    updatedBy: owner.uid,
    createdAt: now,
    updatedAt: now,
  })
  batch.set(doc(db, 'orgs', orgId, 'members', owner.uid), {
    uid: owner.uid,
    email: DEMO_EMAIL,
    displayName: 'PM Demo User',
    role: 'owner',
    createdAt: now,
    updatedAt: now,
  })
  batch.set(doc(db, 'orgs', orgId, 'members', collaborator.uid), {
    uid: collaborator.uid,
    email: COLLAB_EMAIL,
    displayName: 'PM Collaborator',
    role: 'member',
    createdAt: now,
    updatedAt: now,
  })

  batch.set(doc(db, 'users', owner.uid, 'projects', legacyProjectId), {
    name: 'Harbor Tower Scaffold',
    pinned: true,
    folderName: 'PM Jobs',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    ...createEmptyLegacyProjectData(),
  })

  batch.set(doc(db, 'jobs', jobId), {
    orgId,
    title: 'Harbor Tower Scaffold',
    customer: 'Acme Industrial',
    siteAddress: '425 Harbor Industrial Way, Tampa, FL',
    stageId: 'engineering',
    keyDates: { deliveryDate: '2026-03-21' },
    latestDesignRevId: legacyProjectId,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })

  const stages = [
    ['intake', 'Backlog', 'slate', false],
    ['engineering', 'To do', 'amber', false],
    ['approval', 'In progress', 'blue', false],
    ['fabrication', 'Review', 'purple', false],
    ['complete', 'Done', 'green', true],
  ]
  stages.forEach(([id, name, colorToken, isClosedStage], index) => {
    batch.set(doc(db, 'jobs', jobId, 'stages', id), {
      name,
      order: index,
      colorToken,
      ...(isClosedStage ? { isClosedStage: true } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: owner.uid,
      updatedBy: owner.uid,
    })
  })

  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_soon'), {
    orgId,
    jobId,
    title: 'Engineering review package',
    description: 'Verify bay spacing, ledger ties, and client scope before fabrication release.',
    stageId: 'engineering',
    assigneeUid: owner.uid,
    dueDate: dueSoonDate,
    priority: 'high',
    completedAt: null,
    sortKey: 1000,
    groupKey: owner.uid,
    subtaskCount: 1,
    commentCount: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_quick_actions'), {
    orgId,
    jobId,
    title: 'Quick actions coordination',
    description: 'Use this card to verify hover actions, inline rename, due dates, and subtask preview behavior.',
    stageId: 'engineering',
    assigneeUid: owner.uid,
    dueDate: null,
    priority: 'normal',
    completedAt: null,
    sortKey: 1250,
    groupKey: owner.uid,
    subtaskCount: 3,
    commentCount: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_today'), {
    orgId,
    jobId,
    title: 'Today label task',
    description: 'Seeded specifically to verify the Today due-date label.',
    stageId: 'engineering',
    assigneeUid: owner.uid,
    dueDate: todayDate,
    priority: 'normal',
    completedAt: null,
    sortKey: 1500,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_tomorrow'), {
    orgId,
    jobId,
    title: 'Tomorrow label task',
    description: 'Seeded specifically to verify the Tomorrow due-date label.',
    stageId: 'engineering',
    assigneeUid: owner.uid,
    dueDate: tomorrowDate,
    priority: 'low',
    completedAt: null,
    sortKey: 1600,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_weekday'), {
    orgId,
    jobId,
    title: 'Weekday label task',
    description: 'Seeded specifically to verify the short weekday due-date label.',
    stageId: 'engineering',
    assigneeUid: owner.uid,
    dueDate: weekdayDate,
    priority: 'low',
    completedAt: null,
    sortKey: 1700,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_overdue'), {
    orgId,
    jobId,
    title: 'Client approval follow-up',
    description: 'Close the loop on access revisions and attach the latest marked-up drawing set.',
    stageId: 'approval',
    assigneeUid: owner.uid,
    dueDate: overdueDate,
    priority: 'critical',
    completedAt: null,
    sortKey: 2000,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_archive_ready'), {
    orgId,
    jobId,
    title: 'Archive-ready completion',
    description: 'A completed task that should be eligible for per-card archiving.',
    stageId: 'complete',
    assigneeUid: owner.uid,
    dueDate: null,
    priority: 'normal',
    completedAt: now,
    sortKey: 1000,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_bulk_archive'), {
    orgId,
    jobId,
    title: 'Bulk archive candidate',
    description: 'A second completed task used to verify bulk archive behavior.',
    stageId: 'complete',
    assigneeUid: owner.uid,
    dueDate: null,
    priority: 'high',
    completedAt: now,
    sortKey: 2000,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_archived_existing'), {
    orgId,
    jobId,
    title: 'Previously archived coordination',
    description: 'Pre-archived task used to verify the archived task view and restore behavior.',
    stageId: 'complete',
    assigneeUid: owner.uid,
    dueDate: null,
    priority: 'normal',
    completedAt: now,
    isArchived: true,
    archivedAt: now,
    archivedBy: owner.uid,
    sortKey: 3000,
    groupKey: owner.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_collab'), {
    orgId,
    jobId,
    title: 'Fabrication hold-point audit',
    description: 'Confirm tagged revisions and material pickups.',
    stageId: 'fabrication',
    assigneeUid: collaborator.uid,
    dueDate: dueSoonDate,
    priority: 'normal',
    completedAt: null,
    sortKey: 3000,
    groupKey: collaborator.uid,
    subtaskCount: 0,
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })

  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_soon', 'subtasks', 'subtask_scope'), {
    title: 'Confirm scaffold dimensions',
    completed: false,
    sortKey: 1000,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_quick_actions', 'subtasks', 'subtask_dimensions'), {
    title: 'Confirm scaffold dimensions',
    completed: false,
    sortKey: 1000,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_quick_actions', 'subtasks', 'subtask_access'), {
    title: 'Confirm access width',
    completed: true,
    sortKey: 2000,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_quick_actions', 'subtasks', 'subtask_anchor_notes'), {
    title: 'Verify anchor notes',
    completed: false,
    sortKey: 3000,
    createdAt: now,
    updatedAt: now,
    createdBy: owner.uid,
    updatedBy: owner.uid,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_soon', 'comments', 'comment_scope'), {
    authorUid: owner.uid,
    body: 'Waiting on one final field measurement before we lock the release package.',
    createdAt: now,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_quick_actions', 'comments', 'comment_quick_actions'), {
    authorUid: owner.uid,
    body: 'This seeded card is intended for hover-action verification in Playwright.',
    createdAt: now,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_soon', 'activity', 'activity_created'), {
    actorUid: owner.uid,
    type: 'task.created',
    payloadSmall: { title: 'Engineering review package' },
    createdAt: now,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_due_soon', 'activity', 'activity_comment'), {
    actorUid: owner.uid,
    type: 'task.comment_added',
    payloadSmall: {},
    createdAt: now,
  })
  batch.set(doc(db, 'jobs', jobId, 'tasks', 'task_quick_actions', 'activity', 'activity_created'), {
    actorUid: owner.uid,
    type: 'task.created',
    payloadSmall: { title: 'Quick actions coordination' },
    createdAt: now,
  })

  await batch.commit()
})

await testEnv.cleanup()

console.log('Seeded PM emulator data:')
console.log(`- login email: ${DEMO_EMAIL}`)
console.log(`- login password: ${DEMO_PASSWORD}`)
console.log(`- job title: Harbor Tower Scaffold`)
