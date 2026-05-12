import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
import { isUserApproved } from '../auth/access'

type GateState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'pending' }
  | { status: 'allowed' }

export function RequireInternalAccess({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' })
  const location = useLocation()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      if (!user) {
        setState({ status: 'unauthenticated' })
        return
      }

      try {
        setState((await isUserApproved(user)) ? { status: 'allowed' } : { status: 'pending' })
      } catch {
        setState({ status: 'pending' })
      }
    })

    return () => unsub()
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="internal-access-loading">
        Checking internal access...
      </div>
    )
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (state.status === 'pending') {
    return <Navigate to="/pending-access" replace />
  }

  return <>{children}</>
}
