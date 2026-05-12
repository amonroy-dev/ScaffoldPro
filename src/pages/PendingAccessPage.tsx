import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react'
import { auth } from '../firebase'
import './PendingAccessPage.css'

export default function PendingAccessPage() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, nextUser => {
      setUser(nextUser)
      setLoading(false)
      if (!nextUser) navigate('/login', { replace: true })
    })

    return () => unsub()
  }, [navigate])

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut(auth)
      navigate('/login', { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <main className="pending-access-page">
      <section className="pending-access-card" aria-labelledby="pending-access-heading">
        <div className="pending-access-mark" aria-hidden="true">
          <ShieldCheck size={28} />
        </div>

        <p className="pending-access-eyebrow">ScaffoldPro internal access</p>
        <h1 id="pending-access-heading">Your account is signed in. Access is pending approval.</h1>
        <p className="pending-access-copy">
          Your Firebase account exists, but this workspace still requires admin approval before you can open
          ScaffoldPro project data.
        </p>

        <div className="pending-access-detail" aria-live="polite">
          {loading ? 'Checking current session...' : `Signed in as ${user?.email ?? 'your company account'}`}
        </div>

        <div className="pending-access-actions">
          <button type="button" onClick={handleSignOut} disabled={signingOut}>
            <LogOut size={18} aria-hidden="true" />
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>

          <Link to="/login" onClick={() => void signOut(auth)}>
            Return to sign in
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  )
}
