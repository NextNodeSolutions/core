import { stringify } from 'smol-toml'

export interface VectorConfig {
	readonly sources: {
		readonly docker: { readonly type: string }
		readonly journald: { readonly type: string }
	}
	readonly transforms: {
		readonly enrich: {
			readonly type: string
			readonly inputs: ReadonlyArray<string>
			readonly source: string
		}
	}
	readonly sinks: {
		readonly victorialogs: {
			readonly type: string
			readonly inputs: ReadonlyArray<string>
			readonly uri: string
			readonly encoding: { readonly codec: string }
			readonly framing: { readonly method: string }
		}
	}
}

export function isVectorConfig(value: unknown): value is VectorConfig {
	if (typeof value !== 'object' || value === null) return false
	return 'sources' in value && 'transforms' in value && 'sinks' in value
}

const VL_STREAM_FIELDS = 'nn_project,nn_client_id'

const REMAP_SOURCE = [
	'.nn_client_id = "${NN_CLIENT_ID}"',
	'.nn_project = "${NN_PROJECT}"',
].join('\n')

/**
 * Render the Vector agent configuration (TOML).
 *
 * The config uses environment variable interpolation (`${}`)
 * resolved by Vector at startup from /etc/vector/vector.env.
 * No project-specific values are baked into the TOML itself.
 */
export function renderVectorToml(): string {
	const config = {
		sources: {
			docker: { type: 'docker_logs' },
			journald: { type: 'journald' },
		},
		transforms: {
			enrich: {
				type: 'remap',
				inputs: ['docker', 'journald'],
				source: REMAP_SOURCE,
			},
		},
		sinks: {
			victorialogs: {
				type: 'http',
				inputs: ['enrich'],
				uri: `\${NN_VL_URL}/insert/jsonline?_stream_fields=${VL_STREAM_FIELDS}`,
				encoding: { codec: 'json' },
				framing: { method: 'newline_delimited' },
			},
		},
	} satisfies VectorConfig

	return stringify(config)
}
