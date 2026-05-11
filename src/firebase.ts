// Firebase configuration for ScaffoldPro
import { getAnalytics } from 'firebase/analytics'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, enableIndexedDbPersistence, getFirestore } from 'firebase/firestore'

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: 'AIzaSyATS9c7hiHrToA2umS_9v2-AOjd2TRKixA',
  authDomain: 'scaffxiq.firebaseapp.com',
  projectId: 'scaffxiq',
  storageBucket: 'scaffxiq.firebasestorage.app',
  messagingSenderId: '880350563490',
  appId: '1:880350563490:web:ba6867d06ffc4185a0dbfb',
  measurementId: 'G-TLZLC3M3JC',
}

// Initialize Firebase
const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

// Initialize services
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const db = getFirestore(app)

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === '1'

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

// Initialize Analytics (only in browser)
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null

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

