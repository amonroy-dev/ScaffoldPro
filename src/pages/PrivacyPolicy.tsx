import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <Link to="/" className="legal-logo">
          <span className="logo-icon">SP</span>
          <span className="logo-text">ScaffoldPro</span>
        </Link>
      </nav>

      <main className="legal-content">
        <h1>Internal Privacy Notice</h1>
        <p className="last-updated">Last updated: May 12, 2026</p>

        <section>
          <h2>1. Data Collected</h2>
          <p>
            ScaffoldPro stores the account, project, drawing, takeoff, job, and activity data needed to operate the
            internal workspace. Firebase Authentication manages passwords and password reset emails.
          </p>
        </section>

        <section>
          <h2>2. Use of Data</h2>
          <p>
            Data is used to authenticate approved users, protect project access, support team workflows, troubleshoot
            issues, and maintain the application.
          </p>
        </section>

        <section>
          <h2>3. Access Control</h2>
          <p>
            Access is limited to approved internal users. Firestore rules restrict sensitive records, and admins
            control workspace approval through the internal access allowlist.
          </p>
        </section>

        <section>
          <h2>4. Security</h2>
          <p>
            Do not put passwords or email provider secrets in project files or Vite environment variables. Report
            suspected unauthorized access to your ScaffoldPro admin immediately.
          </p>
        </section>

        <section>
          <h2>5. Contact</h2>
          <p>Questions about account data, access, or retention should go to your ScaffoldPro admin.</p>
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
