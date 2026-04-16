import { renderVectorEnv } from './vector-env.ts'
import { renderVectorToml } from './vector-toml.ts'

export interface VectorConfigSelectionInput {
	readonly clientId: string
	readonly project: string
	readonly vlUrl: string
}

export interface VectorConfigSelection {
	readonly vectorToml: string | undefined
	readonly vectorEnv: string | undefined
}

/**
 * Decide whether to render a Vector agent config for this convergence run.
 *
 * Vector is only useful when we have a log sink to forward to (`vlUrl`).
 * When unavailable at provisioning time, convergence re-runs once the sink is reachable.
 */
export function selectVectorConfig(
	input: VectorConfigSelectionInput | null,
): VectorConfigSelection {
	if (!input) return { vectorToml: undefined, vectorEnv: undefined }

	return {
		vectorToml: renderVectorToml(),
		vectorEnv: renderVectorEnv({
			clientId: input.clientId,
			project: input.project,
			vlUrl: input.vlUrl,
		}),
	}
}
