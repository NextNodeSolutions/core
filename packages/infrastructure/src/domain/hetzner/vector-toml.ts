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

export function isVectorConfig(candidate: unknown): candidate is VectorConfig {
	if (typeof candidate !== 'object' || candidate === null) return false
	return (
		'sources' in candidate &&
		'transforms' in candidate &&
		'sinks' in candidate
	)
}

const VL_STREAM_FIELDS = 'nn_project,nn_client_id'

// VictoriaLogs maps these Vector fields onto its built-in `_msg` / `_time`
// at ingest. Without them the log body stays trapped in `message`
// (VictoriaLogs' `_msg` is empty) and `unpack_json` - which defaults to
// `_msg` - cannot reach the Caddy access-log JSON, and the dashboard log
// parser (which reads `_msg`/`_time`) surfaces blank lines. Both Vector
// sources (docker_logs, journald) expose `.message` and `.timestamp`.
const VL_MSG_FIELD = 'message'
const VL_TIME_FIELD = 'timestamp'

// `nn_project` is the VPS-level tenant stream (= the host hostname): one
// Vector agent per VPS stamps every line with it, so it identifies the
// VPS log stream, NOT the deploying project. Per-project disambiguation
// uses the `container_name` field docker_logs emits
// (`<project>-<env>-<service>-N`); the dashboards key the VPS view on
// `nn_project` and the project view on a `container_name` prefix.
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
				uri: `\${NN_VL_URL}/insert/jsonline?_stream_fields=${VL_STREAM_FIELDS}&_msg_field=${VL_MSG_FIELD}&_time_field=${VL_TIME_FIELD}`,
				encoding: { codec: 'json' },
				framing: { method: 'newline_delimited' },
			},
		},
	} satisfies VectorConfig

	return stringify(config)
}
