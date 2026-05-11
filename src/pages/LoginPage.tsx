import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithPopup, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider } from '../firebase'
import { homePath } from '../pm/utils/pmRoutes'
import './LoginPage.css'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const notInvited = useMemo(() => params.get('notInvited') === '1', [params])

  const isAllowlisted = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, 'betaAllowlist', uid))
      return snap.exists()
    } catch {
      return false
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError('')

    try {
      const cred = await signInWithPopup(auth, googleProvider)
      const allowed = await isAllowlisted(cred.user.uid)
      if (!allowed) {
        setError('This account is not on the closed beta allowlist yet.')
        return
      }
      navigate(homePath())
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign in with Google'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleEmailSignIn = async (event: React.FormEvent) => {
    event.preventDefault()

    setLoading(true)
    setError('')

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password)
      const allowed = await isAllowlisted(cred.user.uid)
      if (!allowed) {
        setError('This account is not on the closed beta allowlist yet.')
        return
      }
      navigate(homePath())
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed'
      if (errorMessage.includes('auth/invalid-email')) {
        setError('Please enter a valid email address')
      } else if (errorMessage.includes('auth/wrong-password') || errorMessage.includes('auth/user-not-found')) {
        setError('Invalid email or password')
      } else {
        setError(errorMessage)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-page-shell">
        <header className="login-topbar">
          <Link to="/" className="login-brand">
            <span className="login-brand-mark">SP</span>
            <span className="login-brand-copy">
              <strong>ScaffoldPro</strong>
              <small>Scaffold planning system</small>
            </span>
          </Link>

          <div className="login-topbar-actions">
            <Link to="/" className="login-topbar-link">Back to landing</Link>
            <Link to="/#waitlist" className="login-topbar-cta">Request access</Link>
          </div>
        </header>

        <main className="login-main">
          <section className="login-story">
            <div className="login-story-pill">
              <span className="login-story-pill-dot" aria-hidden="true" />
              Private beta for scaffold design and operations teams
            </div>

            <h1 className="login-title">
              Sign in to the
              <span>same planning system.</span>
            </h1>

            <p className="login-story-text">
              The sign-in experience should feel like the rest of ScaffoldPro: bright surfaces, strong hierarchy,
              and a clean path into model, drawings, takeoff, and delivery.
            </p>

            <div className="login-story-points">
              <span>Model-first workspace</span>
              <span>Drawing output</span>
              <span>Takeoff + PM continuity</span>
            </div>

            <div className="login-story-preview" aria-hidden="true">
              <div className="login-preview-feature">
                <p>Connected platform</p>
                <strong>Approved teams enter one calm workspace from planning through handoff.</strong>
                <span>Same product language. Same output chain. No disconnected screens.</span>
              </div>

              <div className="login-preview-grid">
                <div className="login-preview-card">
                  <p>Drawings</p>
                  <strong>Viewport control and issue-ready sheets</strong>
                </div>
                <div className="login-preview-card">
                  <p>Delivery</p>
                  <strong>Takeoff and PM stay attached to the package</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="login-panel">
            <div className="login-card">
              <div className="beta-pill">Closed beta • Invite only</div>
              <h2>Beta sign in</h2>
              <p className="login-subtitle">
                Sign in with an approved account. Need access?{' '}
                <Link to="/#waitlist">Join the waitlist</Link>.
              </p>

              {notInvited ? (
                <div className="login-banner" role="status">
                  Your account is signed in, but it is not approved for the closed beta yet. If you believe
                  this is a mistake, contact support or join the waitlist.
                </div>
              ) : null}

              <button
                className="google-btn"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <div className="divider">
                <span>or continue with email</span>
              </div>

              <form onSubmit={handleEmailSignIn} className="login-form">
                <label className="login-field">
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    required
                  />
                </label>

                <label className="login-field">
                  <span>Password</span>
                  <input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    required
                    minLength={6}
                  />
                </label>

                {error ? <p className="login-error">{error}</p> : null}

                <button type="submit" className="submit-btn" disabled={loading}>
                  {loading ? 'Please wait...' : 'Sign in'}
                </button>
              </form>

              {auth.currentUser ? (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => signOut(auth)}
                  disabled={loading}
                >
                  Sign out
                </button>
              ) : null}

              <p className="legal-note">
                By continuing, you agree to our <Link to="/terms" target="_blank">Terms</Link> and{' '}
                <Link to="/privacy" target="_blank">Privacy Policy</Link>.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
