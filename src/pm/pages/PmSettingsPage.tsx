import { DatabaseZap, HardDriveDownload, ShieldCheck, Wifi } from 'lucide-react'
import { useState } from 'react'
import { requestOfflinePersistence } from '../../firebase'

export default function PmSettingsPage() {
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  const enableOfflineMode = async () => {
    try {
      setPending(true)
      const result = await requestOfflinePersistence()
      setMessage(result.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="pm-page">
      <section className="pm-hero">
        <div>
          <div className="pm-section-eyebrow">Settings</div>
          <h1 className="pm-page-title">Workspace preferences</h1>
          <p className="pm-page-subtitle">Device-level options and implementation notes for the PM module.</p>
        </div>
      </section>

      <div className="pm-page-grid">
        <section className="pm-panel">
          <div className="pm-panel__title"><Wifi size={16} /> Offline mode</div>
          <p className="pm-muted-copy">Enable IndexedDB-backed Firestore caching on this device for smoother field use and spotty-site connectivity.</p>
          <button className="pm-primary-btn" type="button" onClick={() => void enableOfflineMode()} disabled={pending}>
            <HardDriveDownload size={16} />
            {pending ? 'Enabling…' : 'Enable offline mode'}
          </button>
          {message ? <div className="pm-inline-hint">{message}</div> : null}
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><DatabaseZap size={16} /> Environment</div>
          <ul className="pm-bullet-list">
            <li>Firebase emulators: {import.meta.env.VITE_USE_FIREBASE_EMULATORS === '1' ? 'enabled' : 'disabled'}</li>
            <li>Auth emulator host: {import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'default'}</li>
            <li>Firestore emulator host: {import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || 'default'}</li>
          </ul>
        </section>

        <section className="pm-panel">
          <div className="pm-panel__title"><ShieldCheck size={16} /> Data model</div>
          <p className="pm-muted-copy">Jobs live in shared org-aware collections, while the existing design editor remains linked through the legacy user project document.</p>
        </section>
      </div>
    </div>
  )
}