import { MissingEnvError } from '@/lib/adapters/env.ts'
import { logger } from '@/lib/adapters/logger.ts'
import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'
import type { LoadState } from '@/lib/domain/load-state.ts'

export const loadPageState = async <T>(
	scope: string,
	fetcher: () => Promise<T>,
): Promise<LoadState<T>> => {
	try {
		const data = await fetcher()
		return { kind: 'ok', data }
	} catch (error) {
		if (error instanceof MissingEnvError) {
			logger.error(`${scope}: missing config`, { varName: error.varName })
			return {
				kind: 'missing_config',
				varName: error.varName,
				message: error.message,
			}
		}
		if (error instanceof UpstreamApiFailure) {
			logger.error(`${scope}: upstream error`, {
				context: error.context,
				httpStatus: error.httpStatus,
				...error.logContext(),
			})
			return { kind: 'upstream_error', message: error.message }
		}
		const message = error instanceof Error ? error.message : String(error)
		logger.error(`${scope}: unexpected error`, { message })
		return { kind: 'internal_error', message }
	}
}
