import { readJsonRecordEnv } from '#/cli/env.ts'

/**
 * Parse the `ALL_VARS` GitHub Variables payload, or return `{}` if the env var
 * is absent. Variables hold PUBLIC build-time config (never secrets) — the
 * deploy pipeline resolves each service's declared `build_args` names against
 * this map to render the docker-bake build args.
 */
export function readRepoVars(): Record<string, string> {
	return readJsonRecordEnv('ALL_VARS')
}
