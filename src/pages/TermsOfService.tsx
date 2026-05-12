import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function TermsOfService() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <Link to="/" className="legal-logo">
          <span className="logo-icon">SP</span>
          <span className="logo-text">ScaffoldPro</span>
        </Link>
      </nav>

      <main className="legal-content">
        <h1>Internal Use Terms</h1>
        <p className="last-updated">Last updated: May 12, 2026</p>

        <section>
          <h2>1. Authorized Use</h2>
          <p>
            ScaffoldPro is an internal work tool for approved team members. Use it only with your assigned work
            account and only for company-approved scaffold planning, drawings, takeoff, and project delivery work.
          </p>
        </section>

        <section>
          <h2>2. Account Security</h2>
          <p>
            Keep your password private, use a strong passphrase, and report suspected account compromise
            immediately. Do not share accounts or use another person&apos;s credentials.
          </p>
        </section>

        <section>
          <h2>3. Project Data</h2>
          <p>
            Project files, drawings, notes, and job records in ScaffoldPro are company work product. Handle them
            according to internal confidentiality, retention, and customer data requirements.
          </p>
        </section>

        <section>
          <h2>4. Professional Review</h2>
          <p>
            ScaffoldPro supports planning and documentation workflows. It does not replace professional engineering
            judgment, field verification, competent person review, or required safety approvals.
          </p>
        </section>

        <section>
          <h2>5. Acceptable Use</h2>
          <p>Do not attempt unauthorized access, interfere with the system, export data without approval, or use the tool for unlawful or unsafe purposes.</p>
        </section>

        <section>
          <h2>6. Contact</h2>
          <p>Questions about access or use should go to your ScaffoldPro admin.</p>
        </section>
      </main>

      <footer className="legal-footer">
        <p>(c) 2026 ScaffoldPro. Internal use only.</p>
        <div className="legal-links">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  )
}
