import { prepareSourcemaps } from '#/adapters/sentry/prepare-sourcemaps.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'

export async function uploadSourcemapsCommand(): Promise<void> {
	const project = getEnv('SENTRY_PROJECT')
	const target = project
		? {
				organization: requireEnv('SENTRY_ORG'),
				project,
				token: requireEnv('SENTRY_AUTH_TOKEN'),
			}
		: undefined
	await prepareSourcemaps(requireEnv('PIPELINE_BUILD_DIR'), target)
}
