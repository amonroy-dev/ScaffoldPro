import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

type GateState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'denied' }
  | { status: 'allowed' }

/**
 * Closed-beta gate:
 * - requires Firebase Auth
 * - requires Firestore doc existence: betaAllowlist/{uid}
 */
export function RequireBetaAccess({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' })
  const location = useLocation()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ status: 'unauthenticated' })
        return
      }

      try {
        const snap = await getDoc(doc(db, 'betaAllowlist', user.uid))
        if (snap.exists()) setState({ status: 'allowed' })
        else setState({ status: 'denied' })
      } catch {
        // If rules deny reads or network fails, treat as not allowlisted.
        setState({ status: 'denied' })
      }
    })
    return () => unsub()
  }, [])

  if (state.status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 50%, #0a0a0f 100%)',
        color: 'rgba(255,255,255,0.8)',
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif",
      }}>
        Checking beta access…
      </div>
    )
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (state.status === 'denied') {
    return <Navigate to="/login?notInvited=1" replace />
  }

  return <>{children}</>
}
