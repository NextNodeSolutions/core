import type { SupabaseServiceConfig } from '#/config/types.ts'
import { isRecord } from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

export function validateSupabaseService(
	raw: unknown,
): ValidationResult<SupabaseServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.supabase] must be a table'] }
	}
	return { ok: true, section: {} }
}
