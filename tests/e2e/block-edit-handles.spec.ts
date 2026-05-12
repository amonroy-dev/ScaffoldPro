import { expect, test, type Page } from '@playwright/test'

const DEMO_EMAIL = process.env.PM_E2E_EMAIL || 'pm-demo@scaffoldpro.test'
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
	await createJobDialog.getByLabel('Job name').fill(`Block handle debug ${Date.now()}`)
	await createJobDialog.getByLabel('Customer').fill('Debug GC')
	await createJobDialog.getByLabel('Site address').fill('123 Debug Ave')
	await createJobDialog.getByRole('button', { name: 'Create job', exact: true }).click()

	await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)
	await page.getByRole('link', { name: 'Canvas' }).click()
	await expect(page).toHaveURL(/\/jobs\/[^/]+\/canvas$/)

	await expect.poll(
		async () => page.evaluate(() => typeof (window as any).__scaffoldproToolDebug?.getBlockState === 'function'),
	).toBe(true)
	await expect.poll(
		async () => page.evaluate(() => typeof (window as any).__scaffoldproSceneDebug?.setNamedView === 'function'),
	).toBe(true)
}

async function enterBlockTool(page: Page) {
	await page.getByRole('button', { name: 'Scaffold', exact: true }).click()
	let lastError: unknown = null
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const blockToolButton = page.getByRole('button', { name: 'Block generator' }).or(
				page.locator('button[aria-label="Block generator"]').first(),
			)
			await expect(blockToolButton).toBeVisible()
			await blockToolButton.click()
			return
		} catch (error) {
			lastError = error
			await page.waitForTimeout(250)
		}
	}
	throw lastError
}

async function enableBlockPlacement(page: Page) {
	await page.getByTitle('Place blocks').click()
}

async function activateLiveLoadTool(page: Page) {
	await page.getByRole('button', { name: 'Loads', exact: true }).click()
	await page.getByRole('menuitem', { name: 'Live Load' }).click()
}

async function getBlockState(page: Page) {
	return page.evaluate(() => (window as any).__scaffoldproToolDebug?.getBlockState?.() ?? null)
}

async function getCameraState(page: Page) {
	return page.evaluate(() => (window as any).__scaffoldproSceneDebug?.getCameraState?.() ?? null)
}

function cameraDeltaMagnitude(
	a: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null,
	b: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null,
) {
	if (!a || !b) return Number.POSITIVE_INFINITY
	const deltas = [
		a.position.x - b.position.x,
		a.position.y - b.position.y,
		a.position.z - b.position.z,
		a.target.x - b.target.x,
		a.target.y - b.target.y,
		a.target.z - b.target.z,
	]
	return Math.hypot(...deltas)
}

async function dragCanvas(
	page: Page,
	button: 'left' | 'middle' | 'right',
	dx: number,
	dy: number,
	modifier?: 'Shift' | 'Alt' | 'Control' | 'Meta' | 'Space',
) {
	const canvas = page.locator('canvas').first()
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()
	const startX = box!.x + box!.width * 0.72
	const startY = box!.y + box!.height * 0.38
	if (modifier) await page.keyboard.down(modifier)
	await page.mouse.move(startX, startY)
	await page.mouse.down({ button })
	await page.mouse.move(startX + dx, startY + dy, { steps: 12 })
	await page.mouse.up({ button })
	if (modifier) await page.keyboard.up(modifier)
	await page.waitForTimeout(150)
}

async function dragFromClientPoint(
	page: Page,
	button: 'left' | 'middle' | 'right',
	startX: number,
	startY: number,
	dx: number,
	dy: number,
	modifier?: 'Shift' | 'Alt' | 'Control' | 'Meta' | 'Space',
) {
	if (modifier) await page.keyboard.down(modifier)
	await page.mouse.move(startX, startY)
	await page.mouse.down({ button })
	await page.mouse.move(startX + dx, startY + dy, { steps: 12 })
	await page.mouse.up({ button })
	if (modifier) await page.keyboard.up(modifier)
	await page.waitForTimeout(150)
}

function getHandleWorldPoint(
	block: {
		center: { x: number; y: number }
		widthFt: number
		depthFt: number
		heightFt: number
		rotationSteps?: number
	},
	side: 'left' | 'right' | 'top' | 'bottom',
	target: 'hub' | 'head' = 'head',
) {
	const rotationSteps = (((block.rotationSteps ?? 0) % 4) + 4) % 4
	const rotIsOdd = rotationSteps % 2 === 1
	const worldWidthFt = rotIsOdd ? block.depthFt : block.widthFt
	const worldDepthFt = rotIsOdd ? block.widthFt : block.depthFt
	const marginFt = 0.28
	const handleLengthFt = side === 'left' || side === 'right' ? worldDepthFt : worldWidthFt
	const shaftFt = Math.max(0.9, Math.min(1.65, handleLengthFt * 0.18 + 0.45))
	const hubRadiusFt = 0.17
	const headLengthFt = 0.3
	const shaftStartFt = hubRadiusFt + 0.08
	const targetOffsetFt = target === 'head'
		? shaftStartFt + shaftFt + headLengthFt * 0.5 + 0.02
		: 0

	const basePoint =
		side === 'right'
			? { x: block.center.x + worldWidthFt / 2 + marginFt, y: block.center.y }
			: side === 'left'
				? { x: block.center.x - worldWidthFt / 2 - marginFt, y: block.center.y }
				: side === 'top'
					? { x: block.center.x, y: block.center.y + worldDepthFt / 2 + marginFt }
					: { x: block.center.x, y: block.center.y - worldDepthFt / 2 - marginFt }

	return side === 'right'
		? { x: basePoint.x + targetOffsetFt, y: basePoint.y, z: block.heightFt / 2 }
		: side === 'left'
			? { x: basePoint.x - targetOffsetFt, y: basePoint.y, z: block.heightFt / 2 }
			: side === 'top'
				? { x: basePoint.x, y: basePoint.y + targetOffsetFt, z: block.heightFt / 2 }
				: { x: basePoint.x, y: basePoint.y - targetOffsetFt, z: block.heightFt / 2 }
}

async function getHandleClientPoint(
	page: Page,
	side: 'left' | 'right' | 'top' | 'bottom',
	target: 'hub' | 'head' = 'head',
	blockId?: string,
) {
	const state = await getBlockState(page)
	const block = blockId
		? state?.scaffoldBlocks?.find((entry: any) => entry.id === blockId)
		: state?.scaffoldBlocks?.[0]
	if (!block) return null

	return page.evaluate(
		(point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null,
		getHandleWorldPoint(block, side, target),
	)
}

async function clickWorldPoint(page: Page, point: { x: number; y: number; z?: number }) {
	const clientPoint = await page.evaluate((worldPoint) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(worldPoint) ?? null, {
		x: point.x,
		y: point.y,
		z: point.z ?? 0,
	})
	expect(clientPoint).not.toBeNull()
	await page.mouse.move(clientPoint!.x, clientPoint!.y)
	await page.mouse.click(clientPoint!.x, clientPoint!.y)
}

async function dragWorldSelection(
	page: Page,
	start: { x: number; y: number; z?: number },
	end: { x: number; y: number; z?: number },
	modifier?: 'Control' | 'Meta',
) {
	const [startPoint, endPoint] = await Promise.all([
		page.evaluate((worldPoint) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(worldPoint) ?? null, {
			x: start.x,
			y: start.y,
			z: start.z ?? 0,
		}),
		page.evaluate((worldPoint) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(worldPoint) ?? null, {
			x: end.x,
			y: end.y,
			z: end.z ?? 0,
		}),
	])
	expect(startPoint).not.toBeNull()
	expect(endPoint).not.toBeNull()
	if (modifier) await page.keyboard.down(modifier)
	await page.mouse.move(startPoint!.x, startPoint!.y)
	await page.mouse.down()
	await page.mouse.move(endPoint!.x, endPoint!.y, { steps: 12 })
	await page.mouse.up()
	if (modifier) await page.keyboard.up(modifier)
	await page.waitForTimeout(150)
}

async function dragRightHandleToCopy(page: Page, view: 'perspective' | 'top') {
	await openCanvasWorkspace(page)

	await enterBlockTool(page)
	await enableBlockPlacement(page)

	const canvas = page.locator('canvas').first()
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()
	const clickX = box!.x + box!.width * 0.46
	const clickY = box!.y + box!.height * 0.58

	await page.mouse.click(clickX, clickY)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await page.getByTitle('Edit existing blocks (selection mode)').click()
	if (view === 'top') {
		await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
		await page.waitForTimeout(500)
	}
	await page.evaluate(() => {
		const state = (window as any).__scaffoldproToolDebug?.getBlockState?.()
		const firstId = state?.scaffoldBlocks?.[0]?.id
		if (firstId) (window as any).__scaffoldproToolDebug?.selectBlocks?.([firstId])
	})
	await page.getByTitle(/Copy Pull mode/i).click()

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			selectedCount: state?.selectedBlockIds?.length ?? 0,
			blockEditActionMode: state?.blockEditActionMode ?? null,
		}
	}).toEqual({
		selectedCount: 1,
		blockEditActionMode: 'copy',
	})

	const handlePoint = await getHandleClientPoint(page, 'right', 'head')
	expect(handlePoint).not.toBeNull()
	const handleX = handlePoint!.x
	const handleY = handlePoint!.y

	await page.mouse.move(handleX, handleY)
	await page.mouse.down()
	await page.mouse.move(handleX + 180, handleY, { steps: 12 })

	await expect(page.getByTestId('block-interaction-badge')).toContainText(/array/i)

	await page.mouse.up()

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBeGreaterThan(1)
}

async function dragLeftHandleNearThresholdToCopy(page: Page) {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)

	const canvas = page.locator('canvas').first()
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()
	const clickX = box!.x + box!.width * 0.46
	const clickY = box!.y + box!.height * 0.58

	await page.mouse.click(clickX, clickY)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await page.getByTitle('Edit existing blocks (selection mode)').click()
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(500)
	await page.evaluate(() => {
		const state = (window as any).__scaffoldproToolDebug?.getBlockState?.()
		const firstId = state?.scaffoldBlocks?.[0]?.id
		if (firstId) (window as any).__scaffoldproToolDebug?.selectBlocks?.([firstId])
	})
	await page.getByTitle(/Copy Pull mode/i).click()

	const handlePoint = await getHandleClientPoint(page, 'left', 'head')
	expect(handlePoint).not.toBeNull()
	const state = await getBlockState(page)
	const block = state?.scaffoldBlocks?.[0]
	expect(block).toBeTruthy()

	const rotationSteps = (((block.rotationSteps ?? 0) % 4) + 4) % 4
	const rotIsOdd = rotationSteps % 2 === 1
	const worldWidthFt = rotIsOdd ? block.depthFt : block.widthFt
	const worldDepthFt = rotIsOdd ? block.widthFt : block.depthFt
	const marginFt = 0.28
	const shaftFt = Math.max(0.9, Math.min(1.65, worldDepthFt * 0.18 + 0.45))
	const hubRadiusFt = 0.17
	const headLengthFt = 0.3
	const shaftStartFt = hubRadiusFt + 0.08
	const headOffsetFt = shaftStartFt + shaftFt + headLengthFt * 0.5 + 0.02
	const targetWorldPoint = {
		x: block.center.x - worldWidthFt / 2 - marginFt - headOffsetFt - (worldWidthFt - 0.1),
		y: block.center.y,
		z: block.heightFt / 2,
	}
	const targetPoint = await page.evaluate((point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null, targetWorldPoint)
	expect(targetPoint).not.toBeNull()

	await page.mouse.move(handlePoint!.x, handlePoint!.y)
	await page.mouse.down()
	await page.mouse.move(targetPoint!.x, targetPoint!.y, { steps: 12 })

	await expect(page.getByTestId('block-interaction-badge')).toContainText(/Release to create 1 copy|array/i)

	await page.mouse.up()

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return nextState?.scaffoldBlocks?.length ?? 0
	}).toBeGreaterThan(1)
}

test('block tool opens in neutral block mode and 3D body click selects the block', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			activeTool: state?.activeTool ?? null,
			blockEditMode: state?.blockEditMode ?? null,
			blockEditActionMode: state?.blockEditActionMode ?? null,
		}
	}).toEqual({
		activeTool: 'block',
		blockEditMode: true,
		blockEditActionMode: 'neutral',
	})

	await enableBlockPlacement(page)
	const canvas = page.locator('canvas').first()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()
	const clickX = box!.x + box!.width * 0.46
	const clickY = box!.y + box!.height * 0.58
	await page.mouse.click(clickX, clickY)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await page.getByTitle('Edit existing blocks (selection mode)').click()

	const state = await getBlockState(page)
	const block = state?.scaffoldBlocks?.[0]
	expect(block).toBeTruthy()
	const bodyPoint = await page.evaluate((point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null, {
		x: block.center.x,
		y: block.center.y,
		z: Math.max(1, block.heightFt * 0.5),
	})
	expect(bodyPoint).not.toBeNull()

	await page.mouse.click(bodyPoint!.x, bodyPoint!.y)

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return nextState?.selectedBlockIds?.length ?? 0
	}).toBe(1)
})

test('camera navigation is consistent across building, scaffold, and block mode', async ({ page }) => {
	test.slow()
	await openCanvasWorkspace(page)

	const buildingStart = await getCameraState(page)
	expect(buildingStart).not.toBeNull()
	expect(buildingStart?.isOrtho).toBe(false)

	await dragCanvas(page, 'left', 140, 40)
	const afterBuildingLeft = await getCameraState(page)
	expect(cameraDeltaMagnitude(buildingStart, afterBuildingLeft)).toBeLessThan(0.0001)

	await dragCanvas(page, 'middle', 120, 0)
	const afterBuildingMiddle = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterBuildingLeft, afterBuildingMiddle)).toBeGreaterThan(0.1)

	await dragCanvas(page, 'right', 140, 60)
	const afterBuildingRight = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterBuildingMiddle, afterBuildingRight)).toBeGreaterThan(0.1)

	await dragCanvas(page, 'left', 120, 0, 'Shift')
	const afterBuildingShiftLeft = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterBuildingRight, afterBuildingShiftLeft)).toBeGreaterThan(0.1)

	await page.getByRole('button', { name: 'Scaffold', exact: true }).click()
	await page.waitForTimeout(150)

	const scaffoldStart = await getCameraState(page)
	expect(scaffoldStart).not.toBeNull()

	await dragCanvas(page, 'left', 140, 40)
	const afterScaffoldLeft = await getCameraState(page)
	expect(cameraDeltaMagnitude(scaffoldStart, afterScaffoldLeft)).toBeLessThan(0.0001)

	await dragCanvas(page, 'middle', 120, 0)
	const afterScaffoldMiddle = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterScaffoldLeft, afterScaffoldMiddle)).toBeGreaterThan(0.1)

	await dragCanvas(page, 'right', 140, 60)
	const afterScaffoldRight = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterScaffoldMiddle, afterScaffoldRight)).toBeGreaterThan(0.1)

	await dragCanvas(page, 'left', 120, 0, 'Shift')
	const afterScaffoldShiftLeft = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterScaffoldRight, afterScaffoldShiftLeft)).toBeGreaterThan(0.1)

	await enterBlockTool(page)
	const blockStart = await getCameraState(page)
	expect(blockStart).not.toBeNull()

	await dragCanvas(page, 'left', 140, 40)
	const afterBlockLeft = await getCameraState(page)
	expect(cameraDeltaMagnitude(blockStart, afterBlockLeft)).toBeLessThan(0.0001)

	await dragCanvas(page, 'middle', 120, 0)
	const afterBlockMiddle = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterBlockLeft, afterBlockMiddle)).toBeGreaterThan(0.1)

	await dragCanvas(page, 'right', 140, 60)
	const afterBlockRight = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterBlockMiddle, afterBlockRight)).toBeGreaterThan(0.1)

	await dragCanvas(page, 'left', 120, 0, 'Shift')
	const afterBlockShiftLeft = await getCameraState(page)
	expect(cameraDeltaMagnitude(afterBlockRight, afterBlockShiftLeft)).toBeGreaterThan(0.1)

})

test('right-drag orbit over scaffold does not select nearby members', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)

	const canvas = page.locator('canvas').first()
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()
	await page.mouse.click(box!.x + box!.width * 0.46, box!.y + box!.height * 0.58)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await page.keyboard.press('Escape')

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			blockEditActionMode: state?.blockEditActionMode ?? null,
			selectedObjectId: state?.selectedObjectId ?? null,
			selectedBlockIds: state?.selectedBlockIds ?? [],
		}
	}).toEqual({
		blockEditActionMode: 'neutral',
		selectedObjectId: null,
		selectedBlockIds: [],
	})

	const state = await getBlockState(page)
	const block = state?.scaffoldBlocks?.[0]
	expect(block).toBeTruthy()

	const rotationSteps = (((block.rotationSteps ?? 0) % 4) + 4) % 4
	const rotIsOdd = rotationSteps % 2 === 1
	const worldWidthFt = rotIsOdd ? block.depthFt : block.widthFt
	const worldDepthFt = rotIsOdd ? block.widthFt : block.depthFt
	const orbitStart = await page.evaluate((point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null, {
		x: block.center.x - worldWidthFt / 2 + 0.08,
		y: block.center.y - worldDepthFt / 2 + 0.08,
		z: Math.max(2, block.heightFt * 0.45),
	})
	expect(orbitStart).not.toBeNull()

	const beforeOrbit = await getCameraState(page)
	await page.mouse.move(orbitStart!.x, orbitStart!.y)
	await page.mouse.down({ button: 'right' })
	await page.mouse.move(orbitStart!.x + 120, orbitStart!.y + 55, { steps: 12 })
	await page.mouse.up({ button: 'right' })

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return {
			selectedObjectId: nextState?.selectedObjectId ?? null,
			selectedBlockIds: nextState?.selectedBlockIds ?? [],
			cameraNavigationActive: nextState?.cameraNavigationActive ?? null,
		}
	}).toEqual({
		selectedObjectId: null,
		selectedBlockIds: [],
		cameraNavigationActive: false,
	})

	const afterOrbit = await getCameraState(page)
	expect(cameraDeltaMagnitude(beforeOrbit, afterOrbit)).toBeGreaterThan(0.1)
})

test('block mode opens neutral and Escape returns to neutral block mode', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)

	const placeButton = page.getByTitle('Place blocks')
	const editButton = page.getByTitle(/Edit Blocks selection mode|Edit existing blocks \(selection mode\)/i)
	const copyButton = page.getByTitle(/Copy Pull mode/i)
	const moveButton = page.getByTitle(/Move mode/i)

	await expect(placeButton).toHaveAttribute('aria-pressed', 'false')
	await expect(editButton).toHaveAttribute('aria-pressed', 'false')
	await expect(copyButton).toHaveAttribute('aria-pressed', 'false')
	await expect(moveButton).toHaveAttribute('aria-pressed', 'false')

	await copyButton.click()
	await expect(copyButton).toHaveAttribute('aria-pressed', 'true')
	await expect(editButton).toHaveAttribute('aria-pressed', 'false')

	await page.keyboard.press('Escape')
	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			activeTool: state?.activeTool ?? null,
			blockEditMode: state?.blockEditMode ?? null,
			blockEditActionMode: state?.blockEditActionMode ?? null,
		}
	}).toEqual({
		activeTool: 'block',
		blockEditMode: true,
		blockEditActionMode: 'neutral',
	})

	await placeButton.click()
	await expect(placeButton).toHaveAttribute('aria-pressed', 'true')
	await expect(editButton).toHaveAttribute('aria-pressed', 'false')

	await page.keyboard.press('Escape')
	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			activeTool: state?.activeTool ?? null,
			blockEditMode: state?.blockEditMode ?? null,
			blockEditActionMode: state?.blockEditActionMode ?? null,
		}
	}).toEqual({
		activeTool: 'block',
		blockEditMode: true,
		blockEditActionMode: 'neutral',
	})
})

test('move mode keeps neighboring blocks rigid when dragging a block handle', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Width (ft)' }) })
		.locator('input')
		.first()
		.fill('8')
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Depth (ft)' }) })
		.locator('input')
		.first()
		.fill('4')
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(300)

	await clickWorldPoint(page, { x: 0, y: 0 })
	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await page.keyboard.press('r')
	await page.waitForTimeout(150)
	await clickWorldPoint(page, { x: 6, y: 6 })
	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(2)

	const placedState = await getBlockState(page)
	const placedBlocks = [...(placedState?.scaffoldBlocks ?? [])]
	const horizontalBlock = placedBlocks.find((block: any) => ((((Number(block.rotationSteps ?? 0) % 4) + 4) % 4) % 2) === 0)
	const verticalBlock = placedBlocks.find((block: any) => ((((Number(block.rotationSteps ?? 0) % 4) + 4) % 4) % 2) === 1)
	if (!horizontalBlock || !verticalBlock) throw new Error('Expected one horizontal and one vertical block for move rigidity test')

	await page.evaluate(({ horizontalId, verticalId }) => {
		;(window as any).__scaffoldproToolDebug?.editBlock?.(horizontalId, { center: { x: 0, y: 0 } })
		;(window as any).__scaffoldproToolDebug?.editBlock?.(verticalId, { center: { x: 6, y: 6 } })
	}, { horizontalId: horizontalBlock.id, verticalId: verticalBlock.id })

	await expect.poll(async () => {
		const state = await getBlockState(page)
		const nextHorizontal = state?.scaffoldBlocks?.find((block: any) => block.id === horizontalBlock.id)
		const nextVertical = state?.scaffoldBlocks?.find((block: any) => block.id === verticalBlock.id)
		return {
			horizontalCenterX: Number((nextHorizontal?.center?.x ?? NaN).toFixed(2)),
			horizontalCenterY: Number((nextHorizontal?.center?.y ?? NaN).toFixed(2)),
			verticalCenterX: Number((nextVertical?.center?.x ?? NaN).toFixed(2)),
			verticalCenterY: Number((nextVertical?.center?.y ?? NaN).toFixed(2)),
		}
	}).toEqual({
		horizontalCenterX: 0,
		horizontalCenterY: 0,
		verticalCenterX: 6,
		verticalCenterY: 6,
	})

	await page.getByTitle(/Edit Blocks selection mode|Edit existing blocks \(selection mode\)/i).click()
	await page.evaluate((id) => {
		if (id) (window as any).__scaffoldproToolDebug?.selectBlocks?.([id])
	}, horizontalBlock.id)
	await page.getByTitle(/Move mode/i).click()

	const movedBlock = { ...horizontalBlock, center: { x: 0, y: 0 } }
	const neighborBlock = { ...verticalBlock, center: { x: 6, y: 6 } }
	const handleWorldPoint = getHandleWorldPoint(movedBlock, 'left', 'head')
	const handlePoint = await getHandleClientPoint(page, 'left', 'head', horizontalBlock.id)
	const targetPoint = await page.evaluate(
		(point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null,
		{ ...handleWorldPoint, x: handleWorldPoint.x - 2 },
	)
	if (!handlePoint || !targetPoint) throw new Error('Expected move handle projection points to be available')

	await page.mouse.move(handlePoint.x, handlePoint.y)
	await page.mouse.down()
	await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 })
	await page.mouse.up()

	await expect.poll(async () => {
		const state = await getBlockState(page)
		const nextMovedBlock = state?.scaffoldBlocks?.find((block: any) => block.id === movedBlock?.id)
		const nextNeighborBlock = state?.scaffoldBlocks?.find((block: any) => block.id === neighborBlock?.id)
		return {
			movedCenterX: Number((nextMovedBlock?.center?.x ?? NaN).toFixed(2)),
			movedCenterY: Number((nextMovedBlock?.center?.y ?? NaN).toFixed(2)),
			neighborCenterX: Number((nextNeighborBlock?.center?.x ?? NaN).toFixed(2)),
			neighborCenterY: Number((nextNeighborBlock?.center?.y ?? NaN).toFixed(2)),
			neighborWidthFt: Number((nextNeighborBlock?.widthFt ?? NaN).toFixed(2)),
			neighborDepthFt: Number((nextNeighborBlock?.depthFt ?? NaN).toFixed(2)),
		}
	}).toEqual({
		movedCenterX: -2,
		movedCenterY: 0,
		neighborCenterX: Number((neighborBlock.center.x ?? NaN).toFixed(2)),
		neighborCenterY: Number((neighborBlock.center.y ?? NaN).toFixed(2)),
		neighborWidthFt: Number((neighborBlock.widthFt ?? NaN).toFixed(2)),
		neighborDepthFt: Number((neighborBlock.depthFt ?? NaN).toFixed(2)),
	})
})

test('group move removes old shared seam stacks instead of leaving ghost legs behind', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Width (ft)' }) })
		.locator('input')
		.first()
		.fill('8')
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Depth (ft)' }) })
		.locator('input')
		.first()
		.fill('4')
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(500)

	await clickWorldPoint(page, { x: 0, y: 0 })
	await clickWorldPoint(page, { x: 8, y: 0 })
	await clickWorldPoint(page, { x: 16, y: 0 })
	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(3)

	const placedState = await getBlockState(page)
	const sortedBlocks = [...(placedState?.scaffoldBlocks ?? [])]
		.sort((a: any, b: any) => Number(a.center?.x ?? 0) - Number(b.center?.x ?? 0))
	if (sortedBlocks.length !== 3) throw new Error('Expected exactly three blocks for grouped move test')

	await page.evaluate((blockIds) => {
		const debug = (window as any).__scaffoldproToolDebug
		blockIds.forEach((blockId: string, index: number) => {
			debug?.editBlock?.(blockId, { center: { x: index * 8, y: 0 } })
		})
	}, sortedBlocks.map((block: any) => block.id))

	await expect.poll(async () => {
		const state = await getBlockState(page)
		const blocks = [...(state?.scaffoldBlocks ?? [])].sort((a: any, b: any) => Number(a.center?.x ?? 0) - Number(b.center?.x ?? 0))
		return blocks.map((block: any) => ({
			x: Number((block.center?.x ?? NaN).toFixed(2)),
			y: Number((block.center?.y ?? NaN).toFixed(2)),
		}))
	}).toEqual([
		{ x: 0, y: 0 },
		{ x: 8, y: 0 },
		{ x: 16, y: 0 },
	])

	await page.getByTitle(/Edit Blocks selection mode|Edit existing blocks \(selection mode\)/i).click()
	await page.evaluate((ids) => {
		;(window as any).__scaffoldproToolDebug?.selectBlocks?.(ids)
	}, sortedBlocks.map((block: any) => block.id))
	await page.getByTitle(/Move mode/i).click()

	const middleBlock = { ...sortedBlocks[1], center: { x: 8, y: 0 } }
	const [startPoint, targetPoint] = await Promise.all([
		page.evaluate(
			(point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null,
			{ x: middleBlock.center.x, y: middleBlock.center.y, z: middleBlock.heightFt / 2 },
		),
		page.evaluate(
			(point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null,
			{ x: middleBlock.center.x, y: middleBlock.center.y + 6, z: middleBlock.heightFt / 2 },
		),
	])
	if (!startPoint || !targetPoint) throw new Error('Expected grouped move drag points to be available')

	await page.mouse.move(startPoint.x, startPoint.y)
	await page.mouse.down()
	await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 12 })
	await page.mouse.up()

	await expect.poll(async () => {
		const state = await getBlockState(page)
		const blocks = [...(state?.scaffoldBlocks ?? [])].sort((a: any, b: any) => Number(a.center?.x ?? 0) - Number(b.center?.x ?? 0))
		const stacks = state?.scaffoldStacks ?? []
		const oldStackCount = stacks.filter((stack: any) => (
			[Math.abs(Number(stack.y ?? 0) - 2), Math.abs(Number(stack.y ?? 0) + 2)].some((delta) => delta < 0.05)
			&& [-4, 4, 12, 20].some((expectedX) => Math.abs(Number(stack.x ?? 0) - expectedX) < 0.05)
		)).length
		return {
			blocks: blocks.map((block: any) => ({
				x: Number((block.center?.x ?? NaN).toFixed(2)),
				y: Number((block.center?.y ?? NaN).toFixed(2)),
			})),
			stackCount: stacks.length,
			oldStackCount,
		}
	}).toEqual({
		blocks: [
			{ x: 0, y: 6 },
			{ x: 8, y: 6 },
			{ x: 16, y: 6 },
		],
		stackCount: 8,
		oldStackCount: 0,
	})
})

test('top-view block handles can be grabbed to copy blocks', async ({ page }) => {
	await dragRightHandleToCopy(page, 'top')
})

test('perspective-view block handles can be grabbed to copy blocks', async ({ page }) => {
	await dragRightHandleToCopy(page, 'perspective')
})

test('top-view copy can commit when released just short of the next step', async ({ page }) => {
	await dragLeftHandleNearThresholdToCopy(page)
})

test('top-view copy allows corner-touch adjacency when arraying from an L-shape', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(500)

	await clickWorldPoint(page, { x: 0, y: 0 })

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await page.keyboard.press('r')
	await page.waitForTimeout(200)
	await clickWorldPoint(page, { x: -5, y: 5 })

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(2)

	await page.getByTitle('Edit existing blocks (selection mode)').click()
	const state = await getBlockState(page)
	const verticalBlock = state?.scaffoldBlocks?.[1]
	expect(verticalBlock).toBeTruthy()
	await page.evaluate((id) => {
		if (id) (window as any).__scaffoldproToolDebug?.selectBlocks?.([id])
	}, verticalBlock?.id)
	await page.getByTitle(/Copy Pull mode/i).click()

	const handlePoint = await getHandleClientPoint(page, 'left', 'head', verticalBlock?.id)
	expect(handlePoint).not.toBeNull()
	const rotationSteps = (((verticalBlock.rotationSteps ?? 0) % 4) + 4) % 4
	const rotIsOdd = rotationSteps % 2 === 1
	const worldWidthFt = rotIsOdd ? verticalBlock.depthFt : verticalBlock.widthFt
	const worldDepthFt = rotIsOdd ? verticalBlock.widthFt : verticalBlock.depthFt
	const marginFt = 0.28
	const shaftFt = Math.max(0.9, Math.min(1.65, worldDepthFt * 0.18 + 0.45))
	const hubRadiusFt = 0.17
	const headLengthFt = 0.3
	const shaftStartFt = hubRadiusFt + 0.08
	const headOffsetFt = shaftStartFt + shaftFt + headLengthFt * 0.5 + 0.02
	const targetWorldPoint = {
		x: verticalBlock.center.x - worldWidthFt / 2 - marginFt - headOffsetFt - (worldWidthFt - 0.1),
		y: verticalBlock.center.y,
		z: verticalBlock.heightFt / 2,
	}
	const targetPoint = await page.evaluate((point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null, targetWorldPoint)
	expect(targetPoint).not.toBeNull()
	await page.mouse.move(handlePoint!.x, handlePoint!.y)
	await page.mouse.down()
	await page.mouse.move(targetPoint!.x, targetPoint!.y, { steps: 12 })
	await expect(page.getByTestId('block-interaction-badge')).toContainText(/Release to create 1 copy|array/i)
	await page.mouse.up()

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return nextState?.scaffoldBlocks?.length ?? 0
	}).toBeGreaterThan(2)
})

test('live load section click focuses a section card with include exclude toggle', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(500)

	await clickWorldPoint(page, { x: 0, y: 0 })

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	const placedState = await getBlockState(page)
	const block = placedState?.scaffoldBlocks?.[0]
	expect(block).toBeTruthy()

	await activateLiveLoadTool(page)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			activeTool: state?.activeTool ?? null,
			categoryKey: state?.categoryKey ?? null,
			blockEditMode: state?.blockEditMode ?? null,
		}
	}).toEqual({
		activeTool: 'select',
		categoryKey: 'liveLoads',
		blockEditMode: false,
	})

	await page.getByRole('button', { name: /Level 1/i }).click()

	await clickWorldPoint(page, { x: block.center.x, y: block.center.y, z: block.heightFt })

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.selectedLiveLoadDeckTarget
	}).not.toBeNull()

	await expect(page.getByText('Focused section')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Included' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Excluded' })).toBeVisible()
})

test('top-view live load click and marquee operate on the active level only', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Width (ft)' }) })
		.locator('input')
		.first()
		.fill('21')
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Height (ft)' }) })
		.locator('input')
		.first()
		.fill('25')
	await page.locator('.prop-row')
		.filter({ has: page.locator('label', { hasText: 'Planked levels' }) })
		.locator('input')
		.first()
		.fill('3')
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(300)
	await clickWorldPoint(page, { x: 0, y: 0 })

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await activateLiveLoadTool(page)
	await page.getByRole('button', { name: /Level 1/i }).click()
	await page.getByRole('button', { name: /Level 2/i }).click()
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(300)

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return nextState?.activeLiveLoadLevelNumber ?? null
	}).toBe(2)

	const state = await getBlockState(page)
	const placedBlock = state?.scaffoldBlocks?.[0]
	expect(placedBlock).toBeTruthy()

	await clickWorldPoint(page, { x: placedBlock.center.x - 7, y: placedBlock.center.y, z: placedBlock.heightFt })
	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return {
			count: nextState?.selectedLiveLoadDeckTargets?.length ?? 0,
			uniqueLiftCount: Array.from(new Set((nextState?.selectedLiveLoadDeckTargets ?? []).map((target: any) => target.liftIndex))).length,
		}
	}).toEqual({
		count: 1,
		uniqueLiftCount: 1,
	})

	await clickWorldPoint(page, { x: placedBlock.center.x - 7, y: placedBlock.center.y, z: placedBlock.heightFt })
	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return nextState?.selectedLiveLoadDeckTargets?.length ?? 0
	}).toBe(0)

	await dragWorldSelection(
		page,
		{ x: placedBlock.center.x - placedBlock.widthFt / 2 - 0.2, y: placedBlock.center.y + placedBlock.depthFt / 2 + 0.35, z: placedBlock.heightFt },
		{ x: placedBlock.center.x + placedBlock.widthFt / 2 + 0.2, y: placedBlock.center.y - placedBlock.depthFt / 2 - 0.35, z: placedBlock.heightFt },
	)

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return {
			count: nextState?.selectedLiveLoadDeckTargets?.length ?? 0,
			uniqueLiftCount: Array.from(new Set((nextState?.selectedLiveLoadDeckTargets ?? []).map((target: any) => target.liftIndex))).length,
		}
	}).toEqual({
		count: 3,
		uniqueLiftCount: 1,
	})
})

test('top-view middle-mouse drag pans while in live load mode', async ({ page }) => {
	await openCanvasWorkspace(page)
	await enterBlockTool(page)
	await enableBlockPlacement(page)
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(500)

	const canvas = page.locator('canvas').first()
	const box = await canvas.boundingBox()
	expect(box).not.toBeNull()
	await page.mouse.click(box!.x + box!.width * 0.46, box!.y + box!.height * 0.58)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBe(1)

	await activateLiveLoadTool(page)
	await page.getByRole('button', { name: /Level 1/i }).click()

	const state = await getBlockState(page)
	const block = state?.scaffoldBlocks?.[0]
	expect(block).toBeTruthy()
	const dragStart = await page.evaluate(
		(point) => (window as any).__scaffoldproSceneDebug?.projectWorldToClient?.(point) ?? null,
		{
			x: block.center.x,
			y: block.center.y,
			z: Math.max(1, block.heightFt - 0.2),
		},
	)
	expect(dragStart).not.toBeNull()

	const beforePan = await getCameraState(page)
	expect(beforePan?.isOrtho).toBe(true)

	await dragFromClientPoint(page, 'middle', dragStart!.x, dragStart!.y, 140, 90)

	const afterPan = await getCameraState(page)
	expect(cameraDeltaMagnitude(beforePan, afterPan)).toBeGreaterThan(0.1)

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return {
			categoryKey: state?.categoryKey ?? null,
			selectedLiveLoadDeckTarget: state?.selectedLiveLoadDeckTarget ?? null,
		}
	}).toEqual({
		categoryKey: 'liveLoads',
		selectedLiveLoadDeckTarget: null,
	})
})

test('auto around building creates optimized scaffold runs around the target building', async ({ page }) => {
	await openCanvasWorkspace(page)
	const buildingId = await page.evaluate(() => (window as any).__scaffoldproToolDebug?.addBuildingBox?.({
		widthFt: 24,
		depthFt: 16,
		heightFt: 20,
		center: { x: 0, y: 0, z: 10 },
	}))
	await expect.poll(async () => (await getBlockState(page))?.selectedObjectId ?? null).toBe(buildingId)
	await clickWorldPoint(page, { x: -40, y: -40, z: 0 })
	await expect.poll(async () => (await getBlockState(page))?.selectedObjectId ?? null).toBe(null)

	await enterBlockTool(page)
	const autoButton = page.locator('button[data-testid="open-auto-scaffold-modal"]:not([disabled])').first()
	await expect(autoButton).toBeEnabled()
	await autoButton.click()
	await page.getByTestId('auto-scaffold-submit').click()

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBeGreaterThanOrEqual(12)

	const state = await getBlockState(page)
	const blocks = state?.scaffoldBlocks ?? []
	const squareCornerBlocks = blocks.filter((block: any) => Math.abs((block.widthFt ?? 0) - (block.depthFt ?? 0)) < 0.01)
	const straightRuns = blocks.filter((block: any) => Math.abs((block.widthFt ?? 0) - (block.depthFt ?? 0)) >= 0.01)
	const cornerQuadrants = Array.from(new Set(
		squareCornerBlocks.map((block: any) => `${Math.sign(block.center.x)}:${Math.sign(block.center.y)}`),
	)).sort()
	const horizontalRuns = straightRuns.filter((block: any) => ((((block.rotationSteps ?? 0) % 4) + 4) % 4) === 0)
	const verticalRuns = straightRuns.filter((block: any) => ((((block.rotationSteps ?? 0) % 4) + 4) % 4) === 1)

	expect(squareCornerBlocks.length).toBe(4)
	expect(cornerQuadrants).toEqual(['-1:-1', '-1:1', '1:-1', '1:1'])
	expect(horizontalRuns.length).toBeGreaterThan(0)
	expect(verticalRuns.length).toBeGreaterThan(0)
})

test('auto around building results stay individually selectable as segment blocks', async ({ page }) => {
	await openCanvasWorkspace(page)
	const buildingId = await page.evaluate(() => (window as any).__scaffoldproToolDebug?.addBuildingBox?.({
		widthFt: 24,
		depthFt: 16,
		heightFt: 20,
		center: { x: 0, y: 0, z: 10 },
	}))
	await expect.poll(async () => (await getBlockState(page))?.selectedObjectId ?? null).toBe(buildingId)
	await clickWorldPoint(page, { x: -40, y: -40, z: 0 })
	await expect.poll(async () => (await getBlockState(page))?.selectedObjectId ?? null).toBe(null)

	await enterBlockTool(page)
	const openAutoButton = page.locator('button[data-testid="open-auto-scaffold-modal"]:not([disabled])').first()
	await expect(openAutoButton).toBeVisible()
	await openAutoButton.click()
	await page.getByTestId('auto-scaffold-submit').click()

	await expect.poll(async () => {
		const state = await getBlockState(page)
		return state?.scaffoldBlocks?.length ?? 0
	}).toBeGreaterThanOrEqual(12)

	await page.getByTitle('Edit existing blocks (selection mode)').click()
	await page.evaluate(() => (window as any).__scaffoldproSceneDebug?.setNamedView?.('ortho-top'))
	await page.waitForTimeout(300)

	const state = await getBlockState(page)
	const candidateBlock = (state?.scaffoldBlocks ?? [])
		.slice()
		.filter((block: any) => Math.abs((block.widthFt ?? 0) - (block.depthFt ?? 0)) >= 0.01)
		.sort((a: any, b: any) => a.center.x - b.center.x)[0]
	expect(candidateBlock).toBeTruthy()
	expect((candidateBlock?.widthFt ?? 0) > (candidateBlock?.depthFt ?? 0)).toBe(true)

	await page.evaluate((blockId) => {
		;(window as any).__scaffoldproToolDebug?.selectBlocks?.([blockId])
	}, candidateBlock!.id)

	await expect.poll(async () => {
		const nextState = await getBlockState(page)
		return {
			selectedCount: nextState?.selectedBlockIds?.length ?? 0,
			selectedWidthFt: Math.round(((nextState?.selectedBlock?.widthFt ?? 0) as number) * 100) / 100,
		}
	}).toEqual({
		selectedCount: 1,
		selectedWidthFt: Math.round((candidateBlock?.widthFt ?? 0) * 100) / 100,
	})
})


test('auto scaffold modal stays open while selecting numeric text', async ({ page }) => {
	await openCanvasWorkspace(page)
	const buildingId = await page.evaluate(() => (window as any).__scaffoldproToolDebug?.addBuildingBox?.({
		widthFt: 24,
		depthFt: 16,
		heightFt: 20,
		center: { x: 0, y: 0, z: 10 },
	}))
	await expect.poll(async () => (await getBlockState(page))?.selectedObjectId ?? null).toBe(buildingId)
	await clickWorldPoint(page, { x: -40, y: -40, z: 0 })
	await expect.poll(async () => (await getBlockState(page))?.selectedObjectId ?? null).toBe(null)

	await enterBlockTool(page)
	const openAutoButton = page.locator('button[data-testid="open-auto-scaffold-modal"]:not([disabled])').first()
	await expect(openAutoButton).toBeVisible()
	await openAutoButton.click()

	const dialog = page.getByTestId('auto-scaffold-modal')
	await expect(dialog).toBeVisible()

	const heightInput = dialog.getByLabel('Height (ft)')
	const box = await heightInput.boundingBox()
	expect(box).not.toBeNull()
	await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2)
	await page.mouse.down()
	await page.mouse.move(box!.x + 8, box!.y + box!.height / 2, { steps: 8 })
	await page.mouse.up()

	await expect(dialog).toBeVisible()
	await expect(dialog.getByLabel('Height (ft)')).toHaveValue(/\d+/)
})
