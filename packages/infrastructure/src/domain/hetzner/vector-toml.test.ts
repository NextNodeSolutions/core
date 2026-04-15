import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import type { VectorConfig } from './vector-toml.ts'
import { isVectorConfig, renderVectorToml } from './vector-toml.ts'

function parseVectorConfig(): VectorConfig {
	const parsed: unknown = parse(renderVectorToml())
	if (!isVectorConfig(parsed)) {
		throw new Error('Parsed TOML is not a valid Vector config')
	}
	return parsed
}

describe('renderVectorToml', () => {
	it('produces valid TOML', () => {
		expect(() => parse(renderVectorToml())).not.toThrow()
	})

	it('defines a docker_logs source', () => {
		expect(parseVectorConfig().sources.docker.type).toBe('docker_logs')
	})

	it('defines a journald source', () => {
		expect(parseVectorConfig().sources.journald.type).toBe('journald')
	})

	it('enriches logs with NN_CLIENT_ID and NN_PROJECT env vars', () => {
		const enrich = parseVectorConfig().transforms.enrich
		expect(enrich.type).toBe('remap')
		expect(enrich.source).toContain('${NN_CLIENT_ID}')
		expect(enrich.source).toContain('${NN_PROJECT}')
	})

	it('routes enriched logs from both sources', () => {
		expect(parseVectorConfig().transforms.enrich.inputs).toEqual([
			'docker',
			'journald',
		])
	})

	it('sinks to VictoriaLogs via HTTP with json encoding', () => {
		const sink = parseVectorConfig().sinks.victorialogs
		expect(sink.type).toBe('http')
		expect(sink.encoding.codec).toBe('json')
		expect(sink.framing.method).toBe('newline_delimited')
	})

	it('uses NN_VL_URL env var in sink URI', () => {
		expect(parseVectorConfig().sinks.victorialogs.uri).toContain(
			'${NN_VL_URL}',
		)
	})

	it('streams by nn_project and nn_client_id', () => {
		expect(parseVectorConfig().sinks.victorialogs.uri).toContain(
			'_stream_fields=nn_project,nn_client_id',
		)
	})
})
