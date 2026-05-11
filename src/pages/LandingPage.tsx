import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { ArrowRight, Boxes, ClipboardList, Ruler, ShieldCheck } from 'lucide-react'
import { db } from '../firebase'
import './LandingPage.css'

const proofItems = [
  { value: '3D', label: 'Model-first scaffold planning' },
  { value: 'Sheets', label: 'Drawing output from the same source' },
  { value: 'One flow', label: 'Takeoff and PM aligned to the model' },
]

const flowCards = [
  {
    id: '01',
    icon: Boxes,
    eyebrow: 'Model',
    title: 'Lay out scaffold geometry in a workspace that stays legible.',
    body: 'Place bays, ledgers, planks, and access elements with catalog-aware tools and a canvas built for fast iteration.',
    bullets: ['Readable 3D structure', 'Catalog-backed placement', 'Fast planning rhythm'],
  },
  {
    id: '02',
    icon: Ruler,
    eyebrow: 'Drawings',
    title: 'Push the same intent into sheets without rebuilding the story.',
    body: 'Compose views, adjust framing, and publish drawing packages from the exact geometry the team already approved.',
    bullets: ['Viewport control', 'Sheet composition', 'Field-facing drawing package'],
  },
  {
    id: '03',
    icon: ClipboardList,
    eyebrow: 'Deliver',
    title: 'Carry quantities, notes, and job coordination downstream.',
    body: 'Keep takeoff, scope, and execution connected so operations is not translating screenshots into another system.',
    bullets: ['Takeoff continuity', 'Cleaner handoff', 'PM-ready context'],
  },
]

const betaBenefits = [
  'Priority onboarding for scaffold teams running active jobs',
  'Direct product access while we shape drawings and delivery workflows',
  'A tighter planning stack for modeling, sheets, takeoff, and PM',
]

export default function LandingPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const location = useLocation()

  const scrollToId = useCallback((id: string) => {
    const element = document.getElementById(id)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    const id = location.hash?.startsWith('#') ? location.hash.slice(1) : ''
    if (!id) return
    requestAnimationFrame(() => scrollToId(id))
  }, [location.hash, scrollToId])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email || !name) {
      setError('Please fill in all required fields.')
      return
    }

    setLoading(true)
    setError('')

    try {
      await addDoc(collection(db, 'waitlist'), {
        email,
        name,
        company,
        createdAt: serverTimestamp(),
        status: 'pending',
      })
      setSubmitted(true)
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error('Waitlist signup error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing-page" id="top">
      <nav className="landing-nav">
        <button type="button" className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">
          <span className="landing-brand-mark">SP</span>
          <span className="landing-brand-copy">
            <strong>ScaffoldPro</strong>
            <small>Scaffold planning system</small>
          </span>
        </button>

        <div className="landing-nav-links">
          <button type="button" className="landing-nav-link" onClick={() => scrollToId('product')}>Product</button>
          <button type="button" className="landing-nav-link" onClick={() => scrollToId('flow')}>Flow</button>
          <button type="button" className="landing-nav-link" onClick={() => scrollToId('waitlist')}>Access</button>
        </div>

        <div className="landing-nav-actions">
          <Link to="/login" className="landing-nav-login">Sign in</Link>
          <button type="button" className="landing-nav-cta" onClick={() => scrollToId('waitlist')}>
            Request access
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </nav>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-hero-pill">
              <span className="landing-hero-pill-dot" aria-hidden="true" />
              Private beta for scaffold design and operations teams
            </div>

            <h1 className="landing-hero-title">
              Model the scaffold.
              <span>Ship the package.</span>
            </h1>

            <p className="landing-hero-text">
              ScaffoldPro gives scaffold teams one high-clarity system for layout, drawings, takeoff, and job
              coordination. The model stays connected to the output, so handoff feels deliberate instead of lossy.
            </p>

            <div className="landing-hero-actions">
              <button type="button" className="landing-primary-cta" onClick={() => scrollToId('waitlist')}>
                Request beta access
              </button>
              <button type="button" className="landing-secondary-cta" onClick={() => scrollToId('product')}>
                Explore the product
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="landing-hero-notes">
              <span>3D planning</span>
              <span>Drawing workspace</span>
              <span>Takeoff + PM continuity</span>
            </div>
          </div>

          <div className="landing-hero-preview" aria-hidden="true">
            <div className="landing-preview-shell">
              <div className="landing-preview-topbar">
                <div className="landing-preview-lights">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="landing-preview-tabs">
                  <span className="active">Model</span>
                  <span>Drawings</span>
                  <span>PM</span>
                </div>
              </div>

              <div className="landing-preview-grid">
                <div className="landing-preview-canvas">
                  <div className="landing-preview-canvas-grid" />
                  <div className="landing-preview-bay bay-a" />
                  <div className="landing-preview-bay bay-b" />
                  <div className="landing-preview-bay bay-c" />
                  <div className="landing-preview-callout callout-a">
                    <strong>North elevation</strong>
                    <span>Access bay aligned</span>
                  </div>
                  <div className="landing-preview-callout callout-b">
                    <strong>Takeoff synced</strong>
                    <span>124 components</span>
                  </div>
                </div>

                <div className="landing-preview-stack">
                  <div className="landing-preview-card sheet-card">
                    <div className="landing-preview-card-head">
                      <strong>Issue set</strong>
                      <span>S1.2</span>
                    </div>
                    <div className="landing-preview-sheet">
                      <div className="sheet-frame large" />
                      <div className="sheet-row">
                        <div className="sheet-frame" />
                        <div className="sheet-frame" />
                      </div>
                    </div>
                  </div>

                  <div className="landing-preview-card summary-card">
                    <div className="summary-line">
                      <span>Standards</span>
                      <strong>42</strong>
                    </div>
                    <div className="summary-line">
                      <span>Ledgers</span>
                      <strong>88</strong>
                    </div>
                    <div className="summary-line">
                      <span>Planks</span>
                      <strong>36</strong>
                    </div>
                  </div>

                  <div className="landing-preview-card task-card">
                    <div className="task-pill">PM handoff</div>
                    <strong>Drawing package ready for review</strong>
                    <span>2 approvals pending</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-proof" aria-label="Platform highlights">
          {proofItems.map(item => (
            <article key={item.label} className="landing-proof-card">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </article>
          ))}
        </section>

        <section className="landing-product" id="product">
          <div className="landing-section-intro">
            <p className="landing-section-label">Product</p>
            <div className="landing-section-heading">
              <h2>The planning surface, the drawing surface, and the delivery surface should feel like one product.</h2>
              <p>
                That is the core idea behind ScaffoldPro. The experience is designed to feel calm and expensive,
                but also operationally useful when the job is moving quickly.
              </p>
            </div>
          </div>

          <div className="landing-product-stage">
            <div className="landing-product-panel landing-product-panel-main">
              <p>Connected surfaces</p>
              <strong>The geometry you plan should be the geometry the field sees.</strong>
              <span>
                No hand-built redraw step, no disconnected quantity sheet, no separate project view that has
                to be reconstructed from screenshots.
              </span>
            </div>

            <div className="landing-product-panel">
              <p>Model</p>
              <strong>Fast scaffold layout with readable structure.</strong>
            </div>

            <div className="landing-product-panel">
              <p>Drawings</p>
              <strong>Viewport control, sheets, notes, and issue-ready composition.</strong>
            </div>

            <div className="landing-product-panel">
              <p>Delivery</p>
              <strong>Takeoff and PM context that stay attached to the package.</strong>
            </div>
          </div>
        </section>

        <section className="landing-flow" id="flow">
          <div className="landing-section-intro">
            <p className="landing-section-label">Flow</p>
            <div className="landing-section-heading">
              <h2>High-end software has narrative. Each surface should naturally hand off to the next.</h2>
              <p>
                Instead of a pile of feature cards, the product story should read in sequence: model clearly,
                publish clearly, deliver clearly.
              </p>
            </div>
          </div>

          <div className="landing-flow-list">
            {flowCards.map(card => {
              const Icon = card.icon
              return (
                <article key={card.id} className="landing-flow-card">
                  <div className="landing-flow-meta">
                    <span className="landing-flow-index">{card.id}</span>
                    <div className="landing-flow-icon" aria-hidden="true">
                      <Icon size={18} />
                    </div>
                  </div>

                  <div className="landing-flow-body">
                    <p>{card.eyebrow}</p>
                    <h3>{card.title}</h3>
                    <span>{card.body}</span>
                    <ul>
                      {card.bullets.map(bullet => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="landing-beta" id="waitlist">
          <div className="landing-beta-copy">
            <p className="landing-section-label">Access</p>
            <h2>Join the private beta if you want a more serious scaffold planning stack.</h2>
            <p>
              We are working with teams that care about high-clarity planning, stronger drawing packages, and
              cleaner delivery from design into operations.
            </p>

            <ul className="landing-beta-list">
              {betaBenefits.map(item => (
                <li key={item}>
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="landing-beta-card">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="landing-beta-form">
                <h3>Request beta access</h3>
                <p>Tell us who you are and we will reach out when your seat is ready.</p>

                <div className="landing-form-grid">
                  <label className="landing-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={name}
                      onChange={event => setName(event.target.value)}
                      placeholder="Jane Foreman"
                      required
                    />
                  </label>

                  <label className="landing-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                      placeholder="jane@company.com"
                      required
                    />
                  </label>

                  <label className="landing-field landing-field-full">
                    <span>Company</span>
                    <input
                      type="text"
                      value={company}
                      onChange={event => setCompany(event.target.value)}
                      placeholder="Company name"
                    />
                  </label>
                </div>

                {error ? <p className="landing-form-error">{error}</p> : null}

                <button type="submit" className="landing-primary-cta landing-form-submit" disabled={loading}>
                  {loading ? 'Submitting...' : 'Request access'}
                </button>

                <p className="landing-form-note">
                  By signing up, you agree to our <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
                </p>
              </form>
            ) : (
              <div className="landing-success">
                <div className="landing-success-badge">Access requested</div>
                <h3>You are on the list.</h3>
                <p>We will reach out as soon as your beta access is ready.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <div className="landing-brand landing-brand-static">
            <span className="landing-brand-mark">SP</span>
            <span className="landing-brand-copy">
              <strong>ScaffoldPro</strong>
              <small>Scaffold planning system</small>
            </span>
          </div>
          <p>Model, drawings, takeoff, and delivery flow in one product.</p>
        </div>

        <div className="landing-footer-links">
          <a href="#product">Product</a>
          <a href="#flow">Flow</a>
          <a href="#waitlist">Access</a>
          <Link to="/login">Sign in</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  )
}
