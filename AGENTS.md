# AGENTS.md

## Cursor Cloud specific instructions

ScaffoldPro is a React + TypeScript SPA (Vite) with Firebase (Auth + Firestore) as backend. There is no custom server — all backend logic lives in Firestore security rules. See `package.json` scripts for standard dev commands.

### Services

| Service | Command | Port |
|---|---|---|
| Firebase Emulators (Auth + Firestore + UI) | `npm run emulators:start` | Auth: 9099, Firestore: 8082, UI: 4000 |
| Vite Dev Server | `npm run dev` | 5173 |

Start Firebase emulators **before** the Vite dev server. The dev server must be started with emulator env vars:

```
VITE_USE_FIREBASE_EMULATORS=1 \
VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 \
npm run dev
```

### Seeding demo data

Run `npm run seed:pm` after emulators are up to populate test users and a demo job. Default login: `pm-demo@scaffxiq.test` / `Password123!`.

### Testing

- **Lint:** `npm run lint` — ESLint (pre-existing warnings/errors in the repo are expected).
- **Firestore rules tests:** Run directly against running emulators with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8082 node --test tests/firestore/pm.rules.test.js`. The npm script `test:rules` uses `firebase emulators:exec` which starts its own emulators, so it will fail if emulators are already running on those ports.
- **E2E (Playwright):** `npx playwright test` — Playwright config (`playwright.config.ts`) auto-starts emulators + dev server via `webServer`, and reuses already-running servers when `CI` is not set. Chromium browser must be installed via `npx playwright install chromium`.

### Gotchas

- Java (OpenJDK 21+) is required for Firebase emulators.
- The `test:rules` npm script conflicts with already-running emulators (port clash). Use the direct `node --test` invocation shown above when emulators are already running.
- Some E2E tests (5 out of 30) have pre-existing failures unrelated to environment setup.
