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
  await createJobDialog.getByLabel('Job name').fill(`Hosted face hover ${Date.now()}`)
  await createJobDialog.getByLabel('Customer').fill('Debug GC')
  await createJobDialog.getByLabel('Site address').fill('123 Debug Ave')
  await createJobDialog.getByRole('button', { name: 'Create job', exact: true }).click()

  await expect(page).toHaveURL(/\/jobs\/[^/]+\/pm\/board$/)
  await page.getByRole('link', { name: 'Canvas' }).click()
  await expect(page).toHaveURL(/\/jobs\/[^/]+\/canvas$/)

  await expect.poll(
    async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.addRectBaseMass === 'function'),
  ).toBe(true)
  await expect.poll(
    async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.getBuildingState === 'function'),
  ).toBe(true)
  await expect.poll(
    async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.getBaseMassFaceDebug === 'function'),
  ).toBe(true)
  await expect.poll(
    async () => page.evaluate(() => typeof (window as any).__scaffxiqToolDebug?.selectBuildingEntity === 'function'),
  ).toBe(true)
  await expect.poll(
    async () => page.evaluate(() => typeof (window as any).__scaffxiqSceneDebug?.setNamedView === 'function'),
  ).toBe(true)
}

async function addRectBaseMassAndWait(page: Page, params: {
  widthFt: number
  depthFt: number
  heightFt: number
  center: { x: number; y: number; z: number }
}) {
  const buildingId = await page.evaluate((nextParams) => (window as any).__scaffxiqToolDebug?.addRectBaseMass?.(nextParams) ?? null, params)
  expect(buildingId).toBeTruthy()

  await expect.poll(
    async () => {
      return page.evaluate((entityId) => (window as any).__scaffxiqToolDebug?.getBaseMassFaceDebug?.(entityId, 'front') ?? null, buildingId)
    },
    { timeout: 15000 },
  ).not.toBeNull()

  await page.evaluate((entityId) => {
    ;(window as any).__scaffxiqToolDebug?.selectBuildingEntity?.(entityId)
  }, buildingId)

  await expect.poll(
    async () => {
      const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBuildingState?.() ?? null)
      return state?.selectedBuildingEntityId ?? null
    },
    { timeout: 15000 },
  ).toBe(buildingId)

  await page.waitForTimeout(250)
  return buildingId
}

async function moveMouseToWorldPoint(page: Page, point: { x: number; y: number; z?: number }) {
  const clientPoint = await page.evaluate((worldPoint) => (window as any).__scaffxiqSceneDebug?.projectWorldToClient?.(worldPoint) ?? null, {
    x: point.x,
    y: point.y,
    z: point.z ?? 0,
  })
  expect(clientPoint).not.toBeNull()
  await page.mouse.move(clientPoint!.x, clientPoint!.y)
}

test('side-feature hosted hover resolves the correct wall for all four rect faces', async ({ page }) => {
  await openCanvasWorkspace(page)
  const buildingId = await addRectBaseMassAndWait(page, {
    widthFt: 24,
    depthFt: 16,
    heightFt: 20,
    center: { x: 0, y: 0, z: 10 },
  })
  const faceBasisHandedness = await page.evaluate((entityId) => {
    const faces = ['front', 'back', 'left', 'right'] as const
    return faces.map((faceId) => {
      const face = (window as any).__scaffxiqToolDebug?.getBaseMassFaceDebug?.(entityId, faceId) ?? null
      if (!face) return { faceId, handedness: null }
      const cross = {
        x: face.axisU.y * face.axisV.z - face.axisU.z * face.axisV.y,
        y: face.axisU.z * face.axisV.x - face.axisU.x * face.axisV.z,
        z: face.axisU.x * face.axisV.y - face.axisU.y * face.axisV.x,
      }
      return {
        faceId,
        handedness: cross.x * face.normal.x + cross.y * face.normal.y + cross.z * face.normal.z,
      }
    })
  }, buildingId)
  for (const face of faceBasisHandedness) {
    expect(face.handedness).not.toBeNull()
    expect(face.handedness!).toBeGreaterThan(0.99)
  }

  const sideFeatureButton = page.getByRole('button', { name: /Side Feature/i })
  await expect(sideFeatureButton).toBeVisible({ timeout: 15000 })
  await sideFeatureButton.click()
  await expect.poll(
    async () => {
      const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBuildingState?.() ?? null)
      return {
        activeTool: state?.activeTool ?? null,
        hostKind: state?.buildingHostedSketchIntent?.hostKind ?? null,
      }
    },
    { timeout: 10000 },
  ).toEqual({
    activeTool: 'rectangle',
    hostKind: 'side-face',
  })

  const faceChecks = [
    { view: 'ortho-front', point: { x: 0, y: -8, z: 10 }, expected: 'front' },
    { view: 'ortho-back', point: { x: 0, y: 8, z: 10 }, expected: 'back' },
    { view: 'ortho-left', point: { x: -12, y: 0, z: 10 }, expected: 'left' },
    { view: 'ortho-right', point: { x: 12, y: 0, z: 10 }, expected: 'right' },
  ] as const

  for (const check of faceChecks) {
    await page.evaluate((view) => {
      ;(window as any).__scaffxiqSceneDebug?.setNamedView?.(view)
    }, check.view)
    await page.waitForTimeout(800)
    await moveMouseToWorldPoint(page, check.point)
    await expect.poll(
      async () => {
        const state = await page.evaluate(() => (window as any).__scaffxiqToolDebug?.getBuildingState?.() ?? null)
        return state?.buildingHostedSketchFaceId ?? null
      },
      { timeout: 5000 },
    ).toBe(check.expected)
  }
})
