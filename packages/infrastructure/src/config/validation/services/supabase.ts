import { object } from 'valibot'

import { runSchema } from '../valibot.ts'

import type { SupabaseServiceConfig } from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

const supabaseSchema = object({}, '[services.supabase] must be a table')

export function validateSupabaseService(
	raw: unknown,
): ValidationResult<SupabaseServiceConfig> {
	return runSchema(supabaseSchema, raw)
}
