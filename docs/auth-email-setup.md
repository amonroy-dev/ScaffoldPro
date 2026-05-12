# ScaffoldPro Auth and Email Setup

ScaffoldPro now uses Firebase Authentication for an internal email/password sign-in flow. Google sign-in should stay disabled unless the team intentionally moves to company SSO later.

## Firebase Authentication

1. In Firebase Console, open Authentication > Sign-in method.
2. Enable Email/Password.
3. Keep Google disabled for this internal build.
4. Add the production domain, staging domain, and localhost domains under Authentication > Settings > Authorized domains.
5. Turn on email enumeration protection if it is available for the project.
6. Configure the password policy in Authentication > Settings. Prefer long passwords/passphrases over brittle symbol rules.

## App Environment

Create a local `.env` from `.env.example` and fill in the Firebase web app values:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_ALLOWED_EMAIL_DOMAINS=company.com
```

`VITE_ALLOWED_EMAIL_DOMAINS` is client-side guardrail text and validation. Real access is still controlled by Firebase Auth plus Firestore `accessAllowlist/{uid}`.

## Internal Access Approval

Approved users need a Firestore document at:

```text
accessAllowlist/{uid}
```

Recommended document fields:

```json
{
  "active": true,
  "approvedBy": "admin-user-id",
  "approvedAt": "server timestamp"
}
```

Clients can only read their own access document. They cannot create, update, list, or delete access approvals.

## Password Reset Email

The app uses Firebase Auth's hosted password reset flow through `sendPasswordResetEmail`.

Customize the reset email in Firebase Console > Authentication > Templates:

- Sender name: ScaffoldPro
- Reply-to: your internal support/admin address
- Password reset subject and body
- Authorized domains

The UI intentionally shows a generic success message so it does not reveal whether a coworker account exists.

## Welcome Email

The repo includes a 1st-gen Firebase Auth create trigger in `functions/src/index.ts`. When Firebase Auth creates a user, the function writes a deterministic document to the Trigger Email extension collection:

```text
mail/welcome_{uid}
```

Install Firebase's Trigger Email extension and configure:

- Collection: `mail`
- SMTP or email provider settings in Firebase/GCP extension config
- Sender name/address approved by your email provider

Do not commit SMTP passwords, SendGrid keys, Resend keys, Mailgun keys, or private provider credentials. Configure them only in Firebase/GCP/extension settings.

Set `APP_URL` for the function environment if you want the welcome email CTA to point to the deployed app.

## Deploy and Test

```bash
npm install
npm --prefix functions install
npm run lint
npm run build
npm run functions:build
firebase emulators:start --project demo-scaffoldpro --only auth,firestore,functions
firebase deploy --only functions
```

Firebase CLI 15+ requires JDK 21 or newer for the local emulators.

For emulator testing, create an Auth user in the Auth emulator, add `accessAllowlist/{uid}` in Firestore, then sign in with that email and password.
