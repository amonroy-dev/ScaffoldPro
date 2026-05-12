import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './tests/e2e/globalSetup.mjs',
  webServer: [
    {
      command: 'npm run functions:build && npx firebase emulators:start --project demo-scaffoldpro --only auth,firestore,functions,ui',
      url: 'http://127.0.0.1:4000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_USE_FIREBASE_EMULATORS: '1',
        VITE_FIREBASE_PROJECT_ID: 'demo-scaffoldpro',
        VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
