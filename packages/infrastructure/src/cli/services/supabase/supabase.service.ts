import type { ServiceDefinition } from '#/cli/services/service.ts'

// Supabase has no per-project Service strategy: its lifecycle (compose
// stack render, exporter sidecar, R2 backups alias) is driven from the
// compose-file generator and ensureR2Service, not from provision/loadEnv.
// The definition exists only to satisfy the SERVICE_NAMES → registry
// mapped-type constraint.
export const supabaseServiceDefinition: ServiceDefinition<'supabase'> = {
	name: 'supabase',
	build: () => null,
}
