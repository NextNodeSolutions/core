import { createHmac } from 'node:crypto'

/**
 * Supabase API key roles. `anon` is the public client key (RLS enforces
 * permissions); `service_role` is the server-side admin key (bypasses RLS).
 * Both are deterministic HS256 JWTs signed with `JWT_SECRET` — the keys
 * are derived at deploy time from the secret rather than stored alongside
 * it, so `JWT_SECRET` stays the single secret of record.
 */
export type SupabaseJwtRole = 'anon' | 'service_role'

export interface SupabaseJwtPayload {
	readonly role: SupabaseJwtRole
	readonly iss: 'supabase'
	readonly iat: number
	readonly exp?: number
}

/**
 * JWS header for the Supabase API keys. HMAC-SHA256 is the algorithm the
 * supabase auth/kong/postgrest containers verify against when they decode
 * incoming ANON_KEY / SERVICE_ROLE_KEY bearer tokens — staying on the
 * upstream default keeps the stack drop-in compatible with the
 * supabase/supabase docker-compose template.
 */
const SUPABASE_JWT_HEADER = { alg: 'HS256', typ: 'JWT' } as const

/**
 * Sign a Supabase API JWT using HS256. Produces a compact JWS:
 * `base64url(header).base64url(payload).base64url(HMAC-SHA256(...))`.
 *
 * Pure: takes the payload + secret, returns the JWS string. The caller
 * composes the payload (role + iat + optional exp); the cli/adapter layer
 * reads `JWT_SECRET` and writes the result into `ANON_KEY` /
 * `SERVICE_ROLE_KEY` env vars at deploy time.
 *
 * Uses `node:crypto.createHmac` + the platform-native `'base64url'`
 * encoding (Node ≥ 15.7) — no third-party JWT lib, no manual URL-safe
 * replacement. The header is a module constant so its serialized form is
 * byte-identical across calls.
 */
export function signSupabaseJwt(
	payload: SupabaseJwtPayload,
	secret: string,
): string {
	const headerSegment = Buffer.from(
		JSON.stringify(SUPABASE_JWT_HEADER),
	).toString('base64url')
	const payloadSegment = Buffer.from(JSON.stringify(payload)).toString(
		'base64url',
	)
	const signingInput = `${headerSegment}.${payloadSegment}`
	const signature = createHmac('sha256', secret)
		.update(signingInput)
		.digest('base64url')
	return `${signingInput}.${signature}`
}
