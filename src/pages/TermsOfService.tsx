import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function TermsOfService() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <Link to="/" className="legal-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">ScaffoldPro</span>
        </Link>
      </nav>

      <main className="legal-content">
        <h1>Terms of Service</h1>
        <p className="last-updated">Last updated: February 4, 2025</p>

        <section>
          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing or using ScaffoldPro ("the Service"), you agree to be bound by these 
            Terms of Service. If you disagree with any part of these terms, you may not 
            access the Service.
          </p>
        </section>

        <section>
          <h2>2. Description of Service</h2>
          <p>
            ScaffoldPro is a professional 3D scaffold visualization and planning software 
            designed for construction industry professionals. The Service provides tools 
            for scaffold design, compliance checking, and project documentation.
          </p>
        </section>

        <section>
          <h2>3. User Accounts</h2>
          <p>
            When you create an account, you must provide accurate and complete information. 
            You are responsible for maintaining the security of your account and password. 
            ScaffoldPro cannot and will not be liable for any loss or damage from your failure 
            to comply with this security obligation.
          </p>
        </section>

        <section>
          <h2>4. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to any portion of the Service</li>
            <li>Interfere with or disrupt the integrity of the Service</li>
            <li>Copy, modify, or distribute any content from the Service without permission</li>
            <li>Use the Service to transmit harmful code or malware</li>
          </ul>
        </section>

        <section>
          <h2>5. Intellectual Property</h2>
          <p>
            The Service and its original content, features, and functionality are owned by 
            ScaffoldPro and are protected by international copyright, trademark, and other 
            intellectual property laws. Your designs and projects remain your property.
          </p>
        </section>

        <section>
          <h2>6. Professional Disclaimer</h2>
          <p>
            ScaffoldPro is a design and visualization tool. While we incorporate safety standards 
            and compliance checks, the Service does not replace professional engineering 
            judgment. All scaffold designs should be reviewed by qualified engineers before 
            implementation. ScaffoldPro is not liable for any construction accidents, injuries, 
            or damages resulting from scaffold designs created using the Service.
          </p>
        </section>

        <section>
          <h2>7. Beta Service</h2>
          <p>
            During the beta period, the Service is provided "as is" without warranties of 
            any kind. Features may change, and service availability is not guaranteed. 
            Beta users agree to provide feedback to help improve the Service.
          </p>
        </section>

        <section>
          <h2>8. Limitation of Liability</h2>
          <p>
            In no event shall ScaffoldPro, its directors, employees, or agents be liable for 
            any indirect, incidental, special, consequential, or punitive damages arising 
            from your use of the Service.
          </p>
        </section>

        <section>
          <h2>9. Changes to Terms</h2>
          <p>
            We reserve the right to modify these terms at any time. We will notify users 
            of significant changes via email or through the Service. Continued use after 
            changes constitutes acceptance of the new terms.
          </p>
        </section>

        <section>
          <h2>10. Contact</h2>
          <p>
            If you have questions about these Terms, please contact us at{' '}
            <a href="mailto:legal@scaffoldpro.com">legal@scaffoldpro.com</a>
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

