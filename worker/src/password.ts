// Password hashing on Web Crypto PBKDF2 (native, fast) with legacy bcrypt verification.
// New hashes are self-describing (`pbkdf2$<iterations>$<saltB64>$<hashB64>`) so iterations
// can be raised later without breaking stored hashes. Legacy bcryptjs hashes ($2a$/$2b$)
// still verify; login re-hashes them to PBKDF2 on success (see routes/auth.ts).
import * as bcrypt from 'bcryptjs'

// workerd has historically capped PBKDF2 at 100,000 iterations — going above a runtime cap
// would make every login throw, so this stays at the maximal safe-known value.
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32

const toB64 = (buf: Uint8Array): string => btoa(String.fromCharCode(...buf))
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

// Constant-time comparison. Deliberately not crypto.subtle.timingSafeEqual — that's a
// Workers-only extension, and the unit tests run in plain Node.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// True for bcryptjs hashes written before the PBKDF2 migration ($2a$ / $2b$ / $2y$).
export function isLegacyHash(stored: string): boolean {
  return stored.startsWith('$2')
}

// True when a successfully verified hash should be re-written with hashPassword():
// legacy bcrypt, or a PBKDF2 hash minted with fewer iterations than the current
// setting. Keeps the upgrade policy next to the format so raising
// PBKDF2_ITERATIONS actually migrates existing users on their next login.
export function needsRehash(stored: string): boolean {
  if (isLegacyHash(stored)) return true
  const parts = stored.split('$')
  return parts[0] === 'pbkdf2' && Number(parts[1]) < PBKDF2_ITERATIONS
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(key)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (isLegacyHash(stored)) return bcrypt.compareSync(password, stored)

  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isInteger(iterations) || iterations <= 0) return false
  try {
    const salt = fromB64(parts[2])
    const expected = fromB64(parts[3])
    const actual = await deriveKey(password, salt, iterations)
    return timingSafeEqual(actual, expected)
  } catch {
    return false // malformed base64 in a stored hash — treat as non-matching, not a 500
  }
}
