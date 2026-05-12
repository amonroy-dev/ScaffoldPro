import { expect, test, type Page } from '@playwright/test'

const DEMO_EMAIL = process.env.PM_E2E_EMAIL || 'pm-demo@scaffoldpro.test'
const DEMO_PASSWORD = process.env.PM_E2E_PASSWORD || 'Password123!'
const SEEDED_JOB_TITLE = 'Harbor Tower Scaffold'

function dateAtLocalNoon(offsetDays = 0) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date
}

function toDateInputValue(date: Date) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function weekdayLabel(offsetDays: number) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(dateAtLocalNoon(offsetDays))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function taskCards(page: Page, title: string) {
  return page.locator('.pm-task-card').filter({
    has: page.locator('.pm-task-card__title', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }),
  })
}

function taskCard(page: Page, title: string) {
  return taskCards(page, title).first()
}

function viewportWrappers(page: Page, title: string) {
  return page.locator('.drawing-viewport-wrapper').filter({
    has: page.locator('.drawing-viewport-caption-title-btn', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }),
  })
}

function viewportWrapperByTitle(page: Page, title: string) {
  return viewportWrappers(page, title).first()
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(DEMO_EMAIL)
  await page.getByLabel('Password').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/home$/)
}

async function openSeededBoard(page: Page) {
  await login(page)
  await page.getByRole('link', { name: 'Jobs' }).click()
  const seededRow = page.locator('tr', { hasText: SEEDED_JOB_TITLE })
  await seededRow.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)
  await expect(page.getByRole('link', { name: 'List' })).toBeVisible()
}

test('email login lands on PM home', async ({ page }) => {
  await login(page)

  await expect(page.getByRole('heading', { name: /Today's scaffold operations board/i })).toBeVisible()
  await expect(page.getByLabel('Operations watchlists')).toBeVisible()
  await expect(page.locator('.pm-panel__title').filter({ hasText: 'Overdue work' })).toBeVisible()
  await expect(page.locator('.pm-job-list__title').filter({ hasText: SEEDED_JOB_TITLE }).first()).toBeVisible()
})

test('seeded job supports board, list, and dashboard navigation', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Jobs' }).click()
  await expect(page.getByRole('heading', { name: 'Scaffold job portfolio' })).toBeVisible()

  const seededRow = page.locator('tr', { hasText: SEEDED_JOB_TITLE })
  await seededRow.getByRole('link', { name: 'Tasks', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)
  await expect(page.getByRole('link', { name: 'List' })).toBeVisible()

  await page.getByRole('link', { name: 'List' }).click()
  await expect(page.getByText('Job task list')).toBeVisible()

  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByText('Stage distribution')).toBeVisible()
})

test('job workspace tabs route to dedicated pages (drawings, bom) with current workspace navigation', async ({ page }) => {
  await openSeededBoard(page)

  await page.getByRole('link', { name: 'Drawings', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/drawings$/)
  await expect(page.locator('.drawing-workspace').or(page.locator('.pm-banner--error'))).toBeVisible()

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)

  await page.getByRole('link', { name: 'BOM', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/bom$/)
  await expect(page.locator('.bom-overlay--page').or(page.locator('.pm-banner--error'))).toBeVisible()

  if (await page.getByLabel('Close bill of materials').isVisible()) {
    await page.getByLabel('Close bill of materials').click()
    await expect(page).toHaveURL(/\/jobs\/[^/]+\/canvas$/)
  }
})

test('drawings viewport exposes workflow controls and supports shrink resize', async ({ page }) => {
  await openSeededBoard(page)

  await page.getByRole('link', { name: 'Drawings', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/drawings$/)

  const workspace = page.locator('.drawing-workspace')
  await expect(workspace).toBeVisible()

	const viewportWrapper = viewportWrapperByTitle(page, 'Overall Iso')
	const viewport = viewportWrapper.locator('.drawing-viewport')
  await expect(viewport).toBeVisible()
	const captionRow = viewportWrapper.locator('.drawing-viewport-caption-row')
  await expect(captionRow).toBeVisible()

  const beforeBox = await viewport.boundingBox()
  expect(beforeBox).not.toBeNull()

  await viewport.click()

	  await expect(page.getByRole('button', { name: 'Open' })).toBeVisible()
	  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Horizontal viewport alignment' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Vertical viewport alignment' })).toBeVisible()
	  await expect(page.getByRole('group', { name: 'Viewport tidy distribution' })).toBeVisible()
	  await expect(page.getByRole('button', { name: 'Reset Frame' })).toHaveCount(0)

	const resizeHandle = viewportWrapper.getByRole('button', { name: 'Resize viewport from the bottom right' })
  await expect(resizeHandle).toBeVisible()
  const handleBox = await resizeHandle.boundingBox()
  expect(handleBox).not.toBeNull()

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x - 70, handleBox!.y - 55, { steps: 12 })
  await page.mouse.up()

  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeLessThan((beforeBox?.width ?? 0) - 12)
  await expect.poll(async () => (await viewport.boundingBox())?.height ?? 0).toBeLessThan((beforeBox?.height ?? 0) - 12)
})

test('drawings viewport supports duplicate title edits and anchor-based match tools', async ({ page }) => {
	await openSeededBoard(page)

	await page.getByRole('link', { name: 'Drawings', exact: true }).click()
	await expect(page).toHaveURL(/\/jobs\/[^/]+\/drawings$/)

	const overallWrapper = viewportWrapperByTitle(page, 'Overall Iso')
	const northWrapper = viewportWrapperByTitle(page, 'North Elevation')
	const southWrapper = viewportWrapperByTitle(page, 'South Elevation')
	const duplicatedOverallWrapper = viewportWrapperByTitle(page, 'Overall Iso Copy')
	const overallViewport = overallWrapper.locator('.drawing-viewport')
	const northViewport = northWrapper.locator('.drawing-viewport')
	const southViewport = southWrapper.locator('.drawing-viewport')
	const duplicatedOverallViewport = duplicatedOverallWrapper.locator('.drawing-viewport')

	await expect(overallViewport).toBeVisible()
	await expect(northViewport).toBeVisible()
	await expect(southViewport).toBeVisible()

	await overallViewport.click({ force: true })
	await page.getByRole('button', { name: 'Copy' }).click()
	await expect(viewportWrappers(page, 'Overall Iso')).toHaveCount(2)

	const selectedDuplicatedOverallWrapper = page.locator('.drawing-viewport-wrapper').filter({
		has: page.locator('.drawing-viewport-action-capsule'),
		hasText: 'Overall Iso',
	}).first()
	await selectedDuplicatedOverallWrapper.locator('.drawing-viewport-caption-title-btn').dblclick()
	await page.getByLabel('Viewport title').fill('Overall Iso Copy')
	await page.getByRole('button', { name: 'Save' }).click()
	await expect(duplicatedOverallWrapper).toBeVisible()

	const overallBeforeBox = await overallViewport.boundingBox()
	expect(overallBeforeBox).not.toBeNull()

	await overallViewport.click({ force: true, position: { x: 8, y: 8 } })
	await southViewport.click({ modifiers: ['Control'], force: true })
	await northViewport.click({ modifiers: ['Control'], force: true })
	await expect(overallViewport).toHaveClass(/selected/)
	await expect(southViewport).toHaveClass(/selected/)
	await expect(northViewport).toHaveClass(/selected/)
	await expect(duplicatedOverallViewport).not.toHaveClass(/selected/)

	const matchTools = northWrapper.getByRole('group', { name: 'Viewport match tools' })
	await expect(matchTools).toBeVisible()
	await matchTools.getByRole('button', { name: 'Same Size' }).click()

	await expect.poll(async () => {
		const overallBox = await overallViewport.boundingBox()
		const northBox = await northViewport.boundingBox()
		if (!overallBox || !northBox) return Number.POSITIVE_INFINITY
		return Math.abs(overallBox.width - northBox.width)
	}).toBeLessThan(2)
	await expect.poll(async () => {
		const overallBox = await overallViewport.boundingBox()
		const northBox = await northViewport.boundingBox()
		if (!overallBox || !northBox) return Number.POSITIVE_INFINITY
		return Math.abs(overallBox.height - northBox.height)
	}).toBeLessThan(2)
	await expect.poll(async () => (await overallViewport.boundingBox())?.width ?? 0).toBeLessThan((overallBeforeBox?.width ?? 0) - 16)

	await matchTools.getByRole('button', { name: 'Same Scale' }).click()
	await expect(overallWrapper.locator('.drawing-viewport-caption-scale')).toHaveText("1/4\" = 1'-0\"")
	await expect(viewportWrapperByTitle(page, 'Overall Iso Copy').locator('.drawing-viewport-caption-scale')).toHaveText("1/4\" = 1'-0\"")
})

test('task card quick actions support due dates and the task context menu', async ({ page }) => {
  await openSeededBoard(page)

  const quickTaskCard = taskCard(page, 'Quick actions coordination')
  const duplicateCards = taskCards(page, 'Copy of Quick actions coordination')
  const followUpCards = taskCards(page, 'Follow up on: Quick actions coordination')
  const actions = quickTaskCard.locator('.pm-task-card__actions')

  await quickTaskCard.hover()
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(quickTaskCard.getByRole('button', { name: 'Drag Quick actions coordination' })).toBeVisible()
  await expect(quickTaskCard.getByRole('button', { name: 'Quick due date for Quick actions coordination' })).toBeVisible()
  await expect(quickTaskCard.getByRole('button', { name: 'More actions for Quick actions coordination' })).toBeVisible()

  await quickTaskCard.getByRole('button', { name: 'Quick due date for Quick actions coordination' }).click()
  const dueDialog = page.getByRole('dialog', { name: 'Due date picker for Quick actions coordination' })
  await expect(dueDialog).toBeVisible()
  await dueDialog.getByRole('button', { name: 'Tomorrow' }).click()
  await expect(dueDialog).toHaveCount(0)
  await expect(quickTaskCard.getByText('Tomorrow')).toBeVisible()

  await quickTaskCard.click({ button: 'right' })
  const contextMenu = page.locator('.pm-context-menu')
  await expect(contextMenu).toBeVisible()
  await expect(contextMenu.getByRole('button', { name: 'Duplicate task' })).toBeVisible()
  await expect(contextMenu.getByRole('button', { name: 'Create follow-up task' })).toBeVisible()
  await expect(contextMenu.getByRole('button', { name: 'Add subtask' })).toBeVisible()
  await expect(contextMenu.getByRole('button', { name: 'Open task details' })).toBeVisible()
  await expect(contextMenu.getByRole('button', { name: 'Delete task' })).toBeVisible()

  await contextMenu.getByRole('button', { name: 'Add subtask' }).click()
  await expect(page.getByLabel('Task details drawer')).toBeVisible()
  await expect(page.getByPlaceholder('Add a subtask')).toBeFocused()
  await page.getByLabel('Close task drawer').click()

  const duplicateCountBefore = await duplicateCards.count()
  await quickTaskCard.hover()
  await quickTaskCard.getByRole('button', { name: 'More actions for Quick actions coordination' }).click()
  await page.locator('.pm-context-menu').getByRole('button', { name: 'Duplicate task' }).click()
  await expect(duplicateCards).toHaveCount(duplicateCountBefore + 1)
  await expect(duplicateCards.first()).toBeVisible()

  const followUpCountBefore = await followUpCards.count()
  await quickTaskCard.hover()
  await quickTaskCard.getByRole('button', { name: 'More actions for Quick actions coordination' }).click()
  await page.locator('.pm-context-menu').getByRole('button', { name: 'Create follow-up task' }).click()
  await expect(followUpCards).toHaveCount(followUpCountBefore + 1)
  await expect(followUpCards.first()).toBeVisible()

  await expect(taskCard(page, 'Today label task').locator('.pm-task-card__meta-item').filter({ hasText: 'Today' })).toBeVisible()
  await expect(taskCard(page, 'Tomorrow label task').locator('.pm-task-card__meta-item').filter({ hasText: 'Tomorrow' })).toBeVisible()
  await expect(taskCard(page, 'Weekday label task').locator('.pm-task-card__meta-item').filter({ hasText: weekdayLabel(4) })).toBeVisible()
})

test('archiving a task hides it from the default board and archived view supports restore', async ({ page }) => {
  await openSeededBoard(page)

  await expect(taskCards(page, 'Previously archived coordination')).toHaveCount(0)

  const archiveReadyCard = taskCard(page, 'Archive-ready completion')
  const drawer = page.getByLabel('Task details drawer')
  await expect(archiveReadyCard).toBeVisible()
  await archiveReadyCard.click({ button: 'right' })
  await page.locator('.pm-context-menu').getByRole('button', { name: 'Open task details' }).click()
  await expect(drawer).toBeVisible()
  const archiveButton = drawer.locator('#pm-task-archive')
  await expect(archiveButton).toHaveText('Archive task')
  await archiveButton.click()
  await expect(taskCards(page, 'Archive-ready completion')).toHaveCount(0)

  const archivedToggle = page.locator('.pm-segmented').getByRole('button', { name: /Archived/ })
  await archivedToggle.click()

  const archivedCard = taskCard(page, 'Archive-ready completion')
  await expect(archivedCard).toBeVisible()
  await expect(taskCard(page, 'Previously archived coordination')).toBeVisible()

  await expect(archiveButton).toHaveText('Restore task')
  await archiveButton.click()
  await expect(taskCards(page, 'Archive-ready completion')).toHaveCount(0)

  await page.locator('.pm-segmented').getByRole('button', { name: /Active/ }).click()
  await expect(taskCard(page, 'Archive-ready completion')).toBeVisible()
})

test('bulk archive done tasks moves completed work into archived view', async ({ page }) => {
  await openSeededBoard(page)

  await expect(taskCard(page, 'Bulk archive candidate')).toBeVisible()
  await page.getByRole('button', { name: 'Archive done tasks' }).click()
  await expect(taskCard(page, 'Bulk archive candidate')).toHaveCount(0)

  await page.locator('.pm-segmented').getByRole('button', { name: /Archived/ }).click()
  await expect(taskCard(page, 'Bulk archive candidate')).toBeVisible()
})

test('can create a job from PM, land in job workspace hub, and work with a task drawer', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'New job' }).first().click()

  const createJobDialog = page.getByLabel('Create a PM job')

  await createJobDialog.getByLabel('Job name').fill('Playwright coordination scaffold')
  await createJobDialog.getByLabel('Customer').fill('Playwright GC')
  await createJobDialog.getByLabel('Site address').fill('99 Test Site Way')
  await createJobDialog.getByRole('button', { name: 'Create job', exact: true }).click()

  // Job creation navigates to /jobs/:jobId which redirects to /jobs/:jobId/pm/board
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)

  // Hub tabs should be visible
  await expect(page.getByRole('link', { name: 'Canvas' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'PM Board' })).toBeVisible()

	  const intakeColumn = page.locator('.pm-board-column').filter({ hasText: 'Backlog' })
	  await intakeColumn.getByRole('button', { name: 'Add task' }).click()
	  const intakeInput = intakeColumn.getByPlaceholder('Write a task name')
	  await intakeInput.fill('Playwright coordination task')
	  await intakeInput.press('Enter')

  const taskCard = page.locator('.pm-task-card').filter({ hasText: 'Playwright coordination task' })
  await expect(taskCard).toBeVisible()
  await taskCard.click()

  await expect(page.getByLabel('Task details drawer')).toBeVisible()
  await page.getByPlaceholder('Leave a coordination note, approval update, or blocker…').fill('Playwright smoke comment')
  await page.getByRole('button', { name: 'Post comment' }).click()
  await expect(page.getByRole('article').getByText('Playwright smoke comment')).toBeVisible()
})