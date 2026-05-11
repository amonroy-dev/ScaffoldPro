import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export default async function globalSetup() {
  await execFileAsync(process.execPath, ['scripts/seed-pm-emulator.mjs'], {
    env: {
      ...process.env,
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8082',
    },
    maxBuffer: 1024 * 1024,
  })
}