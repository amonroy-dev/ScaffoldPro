import { expect, test } from '@playwright/test'

const DEMO_EMAIL = process.env.PM_E2E_EMAIL || 'pm-demo@scaffxiq.test'
const DEMO_PASSWORD = process.env.PM_E2E_PASSWORD || 'Password123!'

test('debug create-job landing state', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(DEMO_EMAIL)
  await page.getByLabel('Password').fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/home$/)

  await page.getByRole('button', { name: 'New job' }).first().click()
  const createJobDialog = page.getByLabel('Create a PM job')
  await createJobDialog.getByLabel('Job name').fill(`Debug job ${Date.now()}`)
  await createJobDialog.getByLabel('Customer').fill('Debug GC')
  await createJobDialog.getByLabel('Site address').fill('123 Debug Ave')
  await createJobDialog.getByRole('button', { name: 'Create job', exact: true }).click()

  await expect(page).toHaveURL(/\/jobs\/[^/]+$/)
  await page.waitForTimeout(1500)

  const url = page.url()
  const bodyText = await page.locator('body').innerText()
  const buttonNames = await page.getByRole('button').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('aria-label') || node.textContent || '').map(text => text.trim()).filter(Boolean),
  )
  const linkNames = await page.getByRole('link').evaluateAll(nodes =>
    nodes.map(node => node.textContent || '').map(text => text.trim()).filter(Boolean),
  )

  console.log('DEBUG_URL:', url)
  console.log('DEBUG_BUTTONS:', JSON.stringify(buttonNames, null, 2))
  console.log('DEBUG_LINKS:', JSON.stringify(linkNames, null, 2))
  console.log('DEBUG_BODY_START')
  console.log(bodyText)
  console.log('DEBUG_BODY_END')
})

