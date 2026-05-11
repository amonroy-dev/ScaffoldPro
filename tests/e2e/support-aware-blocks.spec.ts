import { expect, test, type Page } from '@playwright/test'

const DEMO_EMAIL = process.env.PM_E2E_EMAIL || 'pm-demo@scaffxiq.test'
const DEMO_PASSWORD = process.env.PM_E2E_PASSWORD || 'Password123!'

async function login(page: Page) {
	await page.goto('/login')
	await page.getByLabel('Email').fill(DEMO_EMAIL)
	await page.getByLabel('Password').fill(DEMO_PASSWORD)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page).toHaveURL(/\/home$/)
}

async function openCanvasWorkspace(page: Page) {
	await login(page)
	await page.getByRole('button', { name: 'New job' }).first().click()

	const createJobDialog = page.getByLabel('Create a PM job')
	await createJobDialog.getByLabel('Job name').fill(`Support-aware block ${Date.now()}`)
	await createJobDialog.getByLabel('Customer').fill('Debug GC')
	await createJobDialog.getByLabel('Site address').fill('123 Debug Ave')
	await createJobDialog.getByRole('button', { name: 'Create job', exact: true }).click()

	await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)
	await page.getByRole('link', { name: 'Canvas' }).click()
	await expect(page).toHaveURL(/\/jobs\/[^/]+\/canvas$/)

	await expect.poll(
		async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.getBlockState === 'function'),
	).toBe(true)
	await expect.poll(
		async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.editBlock === 'function'),
	).toBe(true)
	await expect.poll(
		async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.setBlockLiveLoad === 'function'),
	).toBe(true)
}

async function enterBlockTool(page: Page) {
	await page.getByRole('button', { name: 'Scaffold', exact: true }).click()
	const blockToolButton = page.getByRole('button', { name: 'Block generator' }).or(
		page.locator('button[aria-label="Block generator"]').first(),
	)
	await expect(blockToolButton).toBeVisible()
	await blockToolButton.click()
}

async function enableBlockPlacement(page: Page) {
	await page.getByTitle('Place blocks').click()
}

async function clickWorldPoint(page: Page, point: { x: number; y: number; z?: number }) {
	const clientPoint = await page.evaluate((worldPoint) => (window as any).__scaffxiqSceneDebug?.projectWorldToClient?.(worldPoint) ?? null, {
		x: point.x,
		y: point.y,
		z: point.z ?? 0,
	})
	expect(clientPoint).not.toBeNull()
	await page.mouse.move(clientPoint!.x, clientPoint!.y)
	await page.mouse.click(clientPoint!.x, clientPoint!.y)
}

async function addBuildingBoxAndWait(page: Page, params: {
	widthFt: number
	depthFt: number
	heightFt: number
	center: { x: number; y: number; z: number }
}) {
	const buildingId = await page.evaluate((nextParams) => (window as any).__scaffxiqToolDebug?.addBuildingBox?.(nextParams) ?? null, params)
	expect(buildingId).toBeTruthy()

	await expect.poll(
		async () => {
			const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
			return state?.selectedObjectId ?? null
		},
		{ timeout: 15000 },
	).toBe(buildingId)

	// Wait one more frame so subsequent scaffold edits use the committed building-support layout.
	await page.waitForTimeout(250)
	return buildingId
}

test('editing a block into mixed roof and ground support shortens the roof-supported legs', async ({ page }) => {
	await openCanvasWorkspace(page)
	await addBuildingBoxAndWait(page, {
		widthFt: 24,
		depthFt: 16,
		heightFt: 20,
		center: { x: 0, y: 0, z: 10 },
	})

	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await clickWorldPoint(page, { x: 10, y: 0, z: 0 })

	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
		return state?.scaffoldBlocks?.length ?? 0
	}, { timeout: 15000 }).toBe(1)

	const initialState = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
	const blockId = initialState?.scaffoldBlocks?.[0]?.id
	expect(blockId).toBeTruthy()

	await page.evaluate((id) => {
		;(window as any).__scaffxiqToolDebug?.editBlock?.(id, {
			heightFt: 30,
			center: { x: 10, y: 0 },
		})
	}, blockId)

	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
		const stacks = Array.isArray(state?.scaffoldStacks) ? state.scaffoldStacks : []
		const shapeStacks = stacks.filter((stack: any) => stack.baseSupport === 'shape')
		const gridStacks = stacks.filter((stack: any) => stack.baseSupport === 'grid')
		if (shapeStacks.length !== 2 || gridStacks.length !== 2) return null
		return {
			shapeSegmentCounts: shapeStacks.map((stack: any) => stack.segments.length).sort((a: number, b: number) => a - b),
			gridSegmentCounts: gridStacks.map((stack: any) => stack.segments.length).sort((a: number, b: number) => a - b),
			managedStackKeys: [...(state.scaffoldBlocks?.[0]?.managedStackKeys ?? [])].sort(),
		}
	}, { timeout: 15000 }).toEqual({
		shapeSegmentCounts: [1, 1],
		gridSegmentCounts: [3, 3],
		managedStackKeys: ['13.5:-1.5', '13.5:1.5', '6.5:-1.5:20', '6.5:1.5:20'],
	})
})

test('editing a block onto a shape above its top support level is rejected with a warning', async ({ page }) => {
	await openCanvasWorkspace(page)
	await addBuildingBoxAndWait(page, {
		widthFt: 24,
		depthFt: 16,
		heightFt: 20,
		center: { x: 0, y: 0, z: 20 },
	})

	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await clickWorldPoint(page, { x: 18, y: 0, z: 0 })

	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
		return state?.scaffoldBlocks?.length ?? 0
	}, { timeout: 15000 }).toBe(1)

	const initialState = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
	const blockId = initialState?.scaffoldBlocks?.[0]?.id
	expect(blockId).toBeTruthy()

	await page.evaluate((id) => {
		;(window as any).__scaffxiqToolDebug?.editBlock?.(id, {
			center: { x: 0, y: 0 },
		})
	}, blockId)

	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
		return typeof state?.blockPlacementWarning === 'string' && state.blockPlacementWarning.startsWith('Block cannot land here')
	}, { timeout: 15000 }).toBe(true)

	const finalState = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
	expect(finalState?.scaffoldBlocks?.[0]?.center).toEqual({ x: 18, y: 0 })
	expect(finalState?.blockPlacementWarning).toContain('Block cannot land here')
})

test('copy pull can duplicate a block live load setup when Copy live loads is checked', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await clickWorldPoint(page, { x: 0, y: 0, z: 0 })

	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
		return state?.scaffoldBlocks?.length ?? 0
	}, { timeout: 15000 }).toBe(1)

	const initialState = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
	const blockId = initialState?.scaffoldBlocks?.[0]?.id
	expect(blockId).toBeTruthy()

	await page.evaluate((id) => {
		;(window as any).__scaffxiqToolDebug?.setBlockLiveLoad?.(id, {
			liveLoadPsf: 75,
			liveLoadDeckLiftIndices: [4],
			liveLoadExcludedBayKeys: ['4:0:0'],
		})
	}, blockId)

	await page.getByRole('button', { name: 'Edit Blocks' }).click()
	await page.getByTitle('Copy Pull mode (select a block, then drag an exposed-side arrow outward to array copies)').click()
	await page.getByLabel('Copy live loads').check()

	await expect.poll(
		async () => page.evaluate(() => typeof (window as any).__scaffxiqBlockToolDebug?.copyBlock === 'function'),
		{ timeout: 15000 },
	).toBe(true)

	await page.evaluate((id) => {
		;(window as any).__scaffxiqBlockToolDebug?.copyBlock?.(id, { x: 7, y: 0 })
	}, blockId)

	await expect.poll(async () => {
		const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBlockState?.() ?? null)
		const copiedBlock = (state?.scaffoldBlocks ?? []).find((block: any) => Math.abs(Number(block?.center?.x ?? 0) - 7) < 1e-6)
		if (!copiedBlock) return null
		return {
			liveLoadPsf: copiedBlock.liveLoadPsf ?? null,
			liveLoadDeckLiftIndices: copiedBlock.liveLoadDeckLiftIndices ?? [],
			liveLoadExcludedBayKeys: copiedBlock.liveLoadExcludedBayKeys ?? [],
		}
	}, { timeout: 15000 }).toEqual({
		liveLoadPsf: 75,
		liveLoadDeckLiftIndices: [4],
		liveLoadExcludedBayKeys: ['4:0:0'],
	})
})
