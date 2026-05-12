import type { User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'

export const ACCESS_ALLOWLIST_COLLECTION = 'accessAllowlist'

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function isReasonableEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)
}

export function getAllowedEmailDomains() {
  const raw = String(import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS ?? '')
  return raw
    .split(',')
    .map((domain: string) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

export function emailMatchesConfiguredDomains(email: string) {
  const domains = getAllowedEmailDomains()
  if (domains.length === 0) return true
  const domain = normalizeEmail(email).split('@')[1] ?? ''
  return domains.includes(domain)
}

export function configuredDomainLabel() {
  const domains = getAllowedEmailDomains()
  if (domains.length === 0) return 'your work email'
  if (domains.length === 1) return `your @${domains[0]} email`
  return 'an approved work email'
}

export async function isUserApproved(user: User) {
  const snap = await getDoc(doc(db, ACCESS_ALLOWLIST_COLLECTION, user.uid))
  if (!snap.exists()) return false
  const data = snap.data()
  return data.active !== false
}
