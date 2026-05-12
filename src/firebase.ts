// Firebase configuration for ScaffoldPro.
import { getAnalytics } from 'firebase/analytics'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, enableIndexedDbPersistence, getFirestore } from 'firebase/firestore'

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === '1'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? (useEmulators ? 'demo-scaffoldpro' : ''),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? 'demo-app-id',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? undefined,
}

if (!firebaseConfig.projectId && !useEmulators) {
  console.warn('Missing VITE_FIREBASE_PROJECT_ID. Add Firebase web config values to your local .env file.')
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

if (useEmulators && typeof window !== 'undefined') {
  const authHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
  const firestoreHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8082'
  const [firestoreHostname, firestorePortRaw] = firestoreHost.split(':')
  const firestorePort = Number(firestorePortRaw || '8082')

  try {
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true })
  } catch {
    // Ignore repeated connect attempts during HMR.
  }

  try {
    connectFirestoreEmulator(db, firestoreHostname || '127.0.0.1', firestorePort)
  } catch {
    // Ignore repeated connect attempts during HMR.
  }
}

export const analytics =
  typeof window !== 'undefined' && firebaseConfig.measurementId ? getAnalytics(app) : null

let offlinePersistenceRequested = false

export async function requestOfflinePersistence() {
  if (offlinePersistenceRequested) return { ok: true as const, message: 'Offline mode is already enabled on this device.' }
  offlinePersistenceRequested = true
  try {
    await enableIndexedDbPersistence(db)
    return { ok: true as const, message: 'Offline mode enabled for this device.' }
  } catch (error: any) {
    offlinePersistenceRequested = false
    return {
      ok: false as const,
      message:
        error?.code === 'failed-precondition'
          ? 'Offline mode could not be enabled because another browser tab already has persistence active.'
          : 'Offline mode could not be enabled on this device.',
    }
  }
}

export default app
