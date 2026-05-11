import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <Link to="/" className="legal-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">ScaffoldPro</span>
        </Link>
      </nav>

      <main className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="last-updated">Last updated: February 4, 2025</p>

        <section>
          <h2>1. Information We Collect</h2>
          <p>We collect information you provide directly to us, including:</p>
          <ul>
            <li><strong>Account Information:</strong> Name, email address, company name when you create an account</li>
            <li><strong>Profile Information:</strong> Any additional information you choose to add to your profile</li>
            <li><strong>Project Data:</strong> Scaffold designs, measurements, and project details you create</li>
            <li><strong>Communications:</strong> Messages you send to us for support or feedback</li>
          </ul>
        </section>

        <section>
          <h2>2. Automatically Collected Information</h2>
          <p>When you use our Service, we automatically collect:</p>
          <ul>
            <li>Device information (browser type, operating system)</li>
            <li>Usage data (features used, time spent in the application)</li>
            <li>Log data (IP address, access times, pages viewed)</li>
            <li>Cookies and similar tracking technologies</li>
          </ul>
        </section>

        <section>
          <h2>3. How We Use Your Information</h2>
          <p>We use collected information to:</p>
          <ul>
            <li>Provide, maintain, and improve the Service</li>
            <li>Process transactions and send related information</li>
            <li>Send technical notices, updates, and security alerts</li>
            <li>Respond to your comments, questions, and support requests</li>
            <li>Monitor and analyze trends, usage, and activities</li>
            <li>Detect, investigate, and prevent fraudulent or unauthorized activity</li>
          </ul>
        </section>

        <section>
          <h2>4. Information Sharing</h2>
          <p>
            We do not sell your personal information. We may share information with:
          </p>
          <ul>
            <li>Service providers who perform services on our behalf</li>
            <li>Professional advisors (lawyers, accountants) as needed</li>
            <li>Law enforcement when required by law</li>
            <li>Other parties in connection with a merger or acquisition</li>
          </ul>
        </section>

        <section>
          <h2>5. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect 
            your personal information against unauthorized access, alteration, disclosure, 
            or destruction. However, no method of transmission over the Internet is 100% 
            secure.
          </p>
        </section>

        <section>
          <h2>6. Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access your personal information</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Object to processing of your data</li>
            <li>Export your data in a portable format</li>
          </ul>
        </section>

        <section>
          <h2>7. Data Retention</h2>
          <p>
            We retain your information for as long as your account is active or as needed 
            to provide you services. We may retain certain information as required by law 
            or for legitimate business purposes.
          </p>
        </section>

        <section>
          <h2>8. Children's Privacy</h2>
          <p>
            The Service is not intended for users under 18 years of age. We do not 
            knowingly collect personal information from children under 18.
          </p>
        </section>

        <section>
          <h2>9. Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. We will notify you of 
            any changes by posting the new policy on this page and updating the "Last 
            updated" date.
          </p>
        </section>

        <section>
          <h2>10. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us at{' '}
            <a href="mailto:privacy@scaffoldpro.com">privacy@scaffoldpro.com</a>
          </p>
        </section>
      </main>

      <footer className="legal-footer">
        <p>© 2024 ScaffoldPro. All rights reserved.</p>
        <div className="legal-links">
          <Link to="/terms">Terms of Service</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </div>
      </footer>
    </div>
  )
}

