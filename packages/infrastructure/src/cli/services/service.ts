import type { ServiceEnv } from '@/domain/services/service.ts'

/**
 * Strategy contract for a per-project service (R2, D1, KV, queues, …).
 *
 * Two operations frame the lifecycle:
 *   - `provision()` runs from `provision.command` and is idempotent. It
 *     creates buckets/databases/tokens and persists the resulting state
 *     somewhere durable (typically the infra R2 state bucket).
 *   - `loadEnv()` runs from `deploy.command` and reads that state back
 *     to project the env vars + credentials the runtime needs.
 *
 * Adding a new service = a new factory + a branch in `resolveServices`;
 * `deploy.command` and `provision.command` stay untouched.
 */
export interface Service {
	readonly name: string
	provision(): Promise<void>
	loadEnv(): Promise<ServiceEnv>
}
