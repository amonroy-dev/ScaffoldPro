import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, collectionGroup, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'

const PROJECT_ID = 'scaffxiq'
const rules = readFileSync('firestore.rules', 'utf8')
const [host, portRaw] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8082').split(':')
const port = Number(portRaw || '8082')

let testEnv

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore()
}

async function seedWorkspace() {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'orgs', 'org_owner'), {
      name: 'Owner Workspace',
      slug: 'org_owner',
      personal: true,
      createdBy: 'owner',
      updatedBy: 'owner',
    })
    await setDoc(doc(db, 'orgs', 'org_owner', 'members', 'owner'), {
      uid: 'owner',
      email: 'owner@scaffxiq.test',
      displayName: 'Owner User',
      role: 'owner',
    })
    await setDoc(doc(db, 'jobs', 'job_1'), {
      orgId: 'org_owner',
      title: 'Seed Job',
      customer: 'Acme GC',
      siteAddress: '1 Harbor Way',
      stageId: 'intake',
      latestDesignRevId: 'legacy_1',
      createdBy: 'owner',
      updatedBy: 'owner',
    })
    await setDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1'), {
      orgId: 'org_owner',
      jobId: 'job_1',
      title: 'Seed Task',
      stageId: 'intake',
      updatedAt: 1,
      sortKey: 1000,
      priority: 'normal',
      assigneeUid: 'owner',
      subtaskCount: 0,
      commentCount: 0,
      createdBy: 'owner',
      updatedBy: 'owner',
    })
    await setDoc(doc(db, 'users', 'owner', 'projects', 'legacy_1'), {
      name: 'Seed Legacy Project',
      folderName: 'PM Jobs',
    })
  })
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules },
  })
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

after(async () => {
  await testEnv.cleanup()
})

test('beta allowlist supports self-read and blocks cross-user reads', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'betaAllowlist', 'owner'), { invitedBy: 'system' })
  })

  await assertSucceeds(getDoc(doc(authedDb('owner'), 'betaAllowlist', 'owner')))
  await assertFails(getDoc(doc(authedDb('other'), 'betaAllowlist', 'owner')))
})

test('legacy project paths preserve self access and deny other users', async () => {
  const ownerDb = authedDb('owner')
  const otherDb = authedDb('other')

  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'owner', 'projects', 'project_1'), { name: 'Owner Project' }))
  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'owner', 'projects', 'project_1', 'dataShards', 'drawingPackage'), { items: [] }))
  await assertFails(getDoc(doc(otherDb, 'users', 'owner', 'projects', 'project_1')))
  await assertFails(setDoc(doc(otherDb, 'users', 'owner', 'projects', 'project_1'), { name: 'Intrusion' }))
})

test('default PM workspace bootstrap can create org and self membership in one batch', async () => {
  const db = authedDb('owner')
  const batch = writeBatch(db)

  batch.set(doc(db, 'orgs', 'org_owner'), {
    name: 'Owner Workspace',
    slug: 'org_owner',
    personal: true,
    createdBy: 'owner',
    updatedBy: 'owner',
  })
  batch.set(doc(db, 'orgs', 'org_owner', 'members', 'owner'), {
    uid: 'owner',
    email: 'owner@scaffxiq.test',
    displayName: 'Owner User',
    role: 'owner',
  })

  await assertSucceeds(batch.commit())
})

test('default PM workspace bootstrap allows self-read before membership exists', async () => {
  const ownerDb = authedDb('owner')
  const otherDb = authedDb('other')

  await assertSucceeds(getDoc(doc(ownerDb, 'orgs', 'org_owner')))
  await assertSucceeds(getDoc(doc(ownerDb, 'orgs', 'org_owner', 'members', 'owner')))
  await assertFails(getDoc(doc(otherDb, 'orgs', 'org_owner')))
  await assertFails(getDoc(doc(otherDb, 'orgs', 'org_owner', 'members', 'owner')))
})

test('PM members can create a linked job batch with stages and legacy project', async () => {
  await seedWorkspace()
  const db = authedDb('owner')
  const batch = writeBatch(db)

  batch.set(doc(db, 'users', 'owner', 'projects', 'legacy_2'), {
    name: 'South Tower Access',
    folderName: 'PM Jobs',
  })
  batch.set(doc(db, 'jobs', 'job_2'), {
    orgId: 'org_owner',
    title: 'South Tower Access',
    customer: 'Acme GC',
    siteAddress: '200 Main St',
    stageId: 'intake',
    latestDesignRevId: 'legacy_2',
    createdBy: 'owner',
    updatedBy: 'owner',
  })
  batch.set(doc(db, 'jobs', 'job_2', 'stages', 'intake'), {
    name: 'Intake',
    order: 0,
    colorToken: 'slate',
  })
  batch.set(doc(db, 'jobs', 'job_2', 'stages', 'engineering'), {
    name: 'Engineering',
    order: 1,
    colorToken: 'amber',
  })

  await assertSucceeds(batch.commit())
})

test('non-members cannot read or mutate PM jobs and tasks', async () => {
  await seedWorkspace()
  const outsiderDb = authedDb('outsider')

  await assertFails(getDoc(doc(outsiderDb, 'jobs', 'job_1')))
  await assertFails(updateDoc(doc(outsiderDb, 'jobs', 'job_1'), { title: 'Hijacked' }))
  await assertFails(setDoc(doc(outsiderDb, 'jobs', 'job_1', 'tasks', 'task_2'), {
    orgId: 'org_owner',
    jobId: 'job_1',
    title: 'Malicious task',
    stageId: 'intake',
    sortKey: 2000,
    priority: 'normal',
    assigneeUid: 'outsider',
    subtaskCount: 0,
    commentCount: 0,
    createdBy: 'outsider',
    updatedBy: 'outsider',
  }))
})

test('members can read and mutate nested PM task resources', async () => {
  await seedWorkspace()
  const db = authedDb('owner')

  await assertSucceeds(getDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1')))
  await assertSucceeds(updateDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1'), { title: 'Seed Task Updated' }))
  await assertSucceeds(setDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1', 'subtasks', 'sub_1'), {
    title: 'Confirm dimensions',
    completed: false,
    sortKey: 1000,
    createdBy: 'owner',
    updatedBy: 'owner',
  }))
  await assertSucceeds(setDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1', 'comments', 'comment_1'), {
    authorUid: 'owner',
    body: 'Need final review by Friday.',
  }))
  await assertSucceeds(setDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1', 'activity', 'activity_1'), {
    actorUid: 'owner',
    type: 'task.comment_added',
  }))
})

test('members can archive or restore PM work and write root job activity', async () => {
  await seedWorkspace()
  const db = authedDb('owner')

  await assertSucceeds(updateDoc(doc(db, 'jobs', 'job_1'), {
    status: 'archived',
    archivedAt: 1,
    archivedBy: 'owner',
  }))
  await assertSucceeds(setDoc(doc(db, 'jobs', 'job_1', 'activity', 'job_activity_1'), {
    actorUid: 'owner',
    type: 'job.archived',
    payloadSmall: {},
  }))
  await assertSucceeds(getDoc(doc(db, 'jobs', 'job_1', 'activity', 'job_activity_1')))

  await assertSucceeds(updateDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1'), {
    isArchived: true,
    archivedAt: 2,
    archivedBy: 'owner',
  }))
  await assertSucceeds(updateDoc(doc(db, 'jobs', 'job_1', 'tasks', 'task_1'), {
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
  }))
})

test('member collection-group task query is allowed for assigned work', async () => {
  await seedWorkspace()
  const db = authedDb('owner')

  await assertSucceeds(getDocs(query(
    collectionGroup(db, 'tasks'),
    where('orgId', '==', 'org_owner'),
    where('assigneeUid', '==', 'owner'),
    orderBy('updatedAt', 'desc'),
    limit(10),
  )))
})

test('member can list org members', async () => {
  await seedWorkspace()
  const db = authedDb('owner')

  await assertSucceeds(getDocs(collection(db, 'orgs', 'org_owner', 'members')))
})