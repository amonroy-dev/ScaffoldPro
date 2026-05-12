import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type User,
} from 'firebase/auth'
import { ArrowRight, Building2, KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import {
  configuredDomainLabel,
  emailMatchesConfiguredDomains,
  isReasonableEmail,
  isUserApproved,
  normalizeEmail,
} from '../auth/access'
import { auth } from '../firebase'
import { homePath } from '../pm/utils/pmRoutes'
import './LoginPage.css'

type AuthMode = 'signin' | 'forgot'
type PendingAction = 'session' | 'signin' | 'reset' | null

type RedirectState = {
  from?: {
    pathname?: string
    search?: string
    hash?: string
  }
}

function getAuthErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''

  if (
    code.includes('auth/invalid-credential') ||
    code.includes('auth/wrong-password') ||
    code.includes('auth/user-not-found')
  ) {
    return 'We could not sign you in with those credentials.'
  }

  if (code.includes('auth/invalid-email')) return 'Enter a valid work email address.'
  if (code.includes('auth/user-disabled')) return 'This account is disabled. Contact your ScaffoldPro admin.'
  if (code.includes('auth/too-many-requests')) return 'Too many attempts. Wait a bit, then try again.'
  if (code.includes('auth/network-request-failed')) return 'Network trouble. Check your connection and try again.'
  if (code.includes('auth/operation-not-allowed')) return 'Email sign-in is not enabled yet. Contact your ScaffoldPro admin.'

  return 'Something went wrong. Try again or contact your ScaffoldPro admin.'
}

function shouldTreatResetAsSuccess(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  return code.includes('auth/user-not-found') || code.includes('auth/invalid-credential')
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>('session')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [sessionUser, setSessionUser] = useState<User | null>(null)

  const navigate = useNavigate()
  const location = useLocation()
  const domainLabel = useMemo(() => configuredDomainLabel(), [])

  const intendedPath = useMemo(() => {
    const state = location.state as RedirectState | null
    const from = state?.from
    const path = `${from?.pathname ?? ''}${from?.search ?? ''}${from?.hash ?? ''}`
    if (path && path !== '/' && path !== '/login' && path !== '/pending-access') return path
    return homePath()
  }, [location.state])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async user => {
      setSessionUser(user)

      if (!user) {
        setPendingAction(null)
        return
      }

      try {
        if (await isUserApproved(user)) {
          navigate(intendedPath, { replace: true })
          return
        }

        navigate('/pending-access', { replace: true })
      } catch {
        navigate('/pending-access', { replace: true })
      } finally {
        setPendingAction(null)
      }
    })

    return () => unsub()
  }, [intendedPath, navigate])

  const clearStatus = () => {
    setError('')
    setSuccess('')
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setPassword('')
    clearStatus()
  }

  const validateEmail = () => {
    const nextEmail = normalizeEmail(email)
    if (!isReasonableEmail(nextEmail)) {
      setError('Enter a valid work email address.')
      return null
    }

    if (!emailMatchesConfiguredDomains(nextEmail)) {
      setError(`Use ${domainLabel} to continue.`)
      return null
    }

    return nextEmail
  }

  const handleAfterAuth = async (user: User) => {
    if (await isUserApproved(user)) {
      navigate(intendedPath, { replace: true })
      return
    }

    navigate('/pending-access', { replace: true })
  }

  const handleEmailSignIn = async (event: React.FormEvent) => {
    event.preventDefault()
    clearStatus()

    const nextEmail = validateEmail()
    if (!nextEmail) return

    if (!password) {
      setError('Enter your password.')
      return
    }

    setPendingAction('signin')

    try {
      const credential = await signInWithEmailAndPassword(auth, nextEmail, password)
      await handleAfterAuth(credential.user)
    } catch (err) {
      setError(getAuthErrorMessage(err))
    } finally {
      setPendingAction(null)
    }
  }

  const handlePasswordReset = async (event: React.FormEvent) => {
    event.preventDefault()
    clearStatus()

    const nextEmail = validateEmail()
    if (!nextEmail) return

    setPendingAction('reset')

    try {
      await sendPasswordResetEmail(auth, nextEmail)
      setSuccess('If an account exists for that email, we sent a reset link.')
    } catch (err) {
      if (shouldTreatResetAsSuccess(err)) {
        setSuccess('If an account exists for that email, we sent a reset link.')
      } else {
        setError(getAuthErrorMessage(err))
      }
    } finally {
      setPendingAction(null)
    }
  }

  const isLoading = pendingAction !== null
  const submitLabel = pendingAction === 'signin' ? 'Signing in...' : 'Sign in'
  const resetLabel = pendingAction === 'reset' ? 'Sending reset link...' : 'Send reset link'

  return (
    <div className="login-page">
      <div className="login-page-shell">
        <header className="login-topbar">
          <Link to="/" className="login-brand" aria-label="ScaffoldPro sign in">
            <span className="login-brand-mark">SP</span>
            <span className="login-brand-copy">
              <strong>ScaffoldPro</strong>
              <small>Internal work tool</small>
            </span>
          </Link>

          <div className="login-topbar-actions">
            <span className="login-topbar-status">
              <ShieldCheck size={16} aria-hidden="true" />
              Company access only
            </span>
          </div>
        </header>

        <main className="login-main">
          <section className="login-panel" aria-label="Authentication">
            <div className="login-card">
              <div className="login-card-icon" aria-hidden="true">
                {mode === 'signin' ? <LockKeyhole size={22} /> : <KeyRound size={22} />}
              </div>

              <h2>{mode === 'signin' ? 'Welcome back' : 'Reset your password'}</h2>
              <p className="login-subtitle">
                {mode === 'signin'
                  ? `Use ${domainLabel} and your ScaffoldPro password.`
                  : 'Enter your work email and Firebase will send the password reset link.'}
              </p>

              {sessionUser ? (
                <div className="login-banner" role="status">
                  Signed in as {sessionUser.email ?? 'your company account'}. Checking internal access...
                </div>
              ) : null}

              <form
                onSubmit={mode === 'signin' ? handleEmailSignIn : handlePasswordReset}
                className="login-form"
              >
                <label className="login-field" htmlFor="login-email">
                  <span>Work email</span>
                  <div className="login-input-wrap">
                    <Mail size={18} aria-hidden="true" />
                    <input
                      id="login-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                      required
                    />
                  </div>
                </label>

                {mode === 'signin' ? (
                  <label className="login-field" htmlFor="login-password">
                    <span>Password</span>
                    <div className="login-input-wrap">
                      <KeyRound size={18} aria-hidden="true" />
                      <input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        required
                      />
                    </div>
                  </label>
                ) : null}

                <div className="login-form-row">
                  {mode === 'signin' ? (
                    <button type="button" className="login-text-btn" onClick={() => switchMode('forgot')}>
                      Forgot password?
                    </button>
                  ) : (
                    <button type="button" className="login-text-btn" onClick={() => switchMode('signin')}>
                      Back to sign in
                    </button>
                  )}
                </div>

                <div className="login-status" aria-live="polite">
                  {error ? <p className="login-error">{error}</p> : null}
                  {success ? <p className="login-success">{success}</p> : null}
                </div>

                <button type="submit" className="submit-btn" disabled={isLoading}>
                  {mode === 'signin' ? submitLabel : resetLabel}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </form>

              <div className="login-admin-note">
                <Building2 size={18} aria-hidden="true" />
                <p>
                  Need access? Ask your ScaffoldPro admin to create your Firebase Auth account and approve your
                  workspace access.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
