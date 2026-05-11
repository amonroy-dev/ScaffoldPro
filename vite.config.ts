import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      // Relax COOP so Firebase Auth's signInWithPopup can poll the popup
      // window (window.closed) without triggering browser warnings.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
})

