import { describe, expect, it } from 'vitest'

import { writePostgresExporterFiles } from './postgres-exporter-rollout.ts'

import type { PostgresExporterRolloutInput } from './postgres-exporter-rollout.ts'
import type { SshSession } from './ssh/session.types.ts'

type RecordedWrite = { readonly path: string; readonly content: string }

function recordingSession(writes: RecordedWrite[]): SshSession {
	return {
		exec: () => Promise.reject(new Error('unused')),
		execWithStdin: () => Promise.reject(new Error('unused')),
		writeFile: (path, content) => {
			writes.push({ path, content })
			return Promise.resolve()
		},
		readFile: () => Promise.resolve(null),
		close: () => {},
		hostKeyFingerprint: 'fp',
	}
}

const ENV_DIR = '/opt/apps/acme/production'

const inputWith = (
	overrides: Partial<PostgresExporterRolloutInput>,
): PostgresExporterRolloutInput => ({
	postgres: { mode: 'embedded' },
	secrets: { POSTGRES_PASSWORD: 'alnumPass123' },
	...overrides,
})

describe('writePostgresExporterFiles', () => {
	it('is a no-op when there is no postgres service', async () => {
		const writes: RecordedWrite[] = []
		await writePostgresExporterFiles(
			recordingSession(writes),
			ENV_DIR,
			inputWith({ postgres: undefined }),
		)
		expect(writes).toEqual([])
	})

	it('is a no-op for a non-embedded (external) postgres', async () => {
		const writes: RecordedWrite[] = []
		await writePostgresExporterFiles(
			recordingSession(writes),
			ENV_DIR,
			inputWith({ postgres: { mode: 'external' } }),
		)
		expect(writes).toEqual([])
	})

	it('fails loud when the embedded deploy lacks POSTGRES_PASSWORD', async () => {
		const writes: RecordedWrite[] = []
		await expect(
			writePostgresExporterFiles(
				recordingSession(writes),
				ENV_DIR,
				inputWith({ secrets: {} }),
			),
		).rejects.toThrow('"POSTGRES_PASSWORD" must be present')
		expect(writes).toEqual([])
	})

	it('writes the bootstrap SQL (carrying the role password) into the initdb dir', async () => {
		const writes: RecordedWrite[] = []
		await writePostgresExporterFiles(
			recordingSession(writes),
			ENV_DIR,
			inputWith({ secrets: { POSTGRES_PASSWORD: 'alnumPass123' } }),
		)

		expect(writes).toHaveLength(1)
		expect(writes[0]?.path).toBe(`${ENV_DIR}/00-pg-monitor.sql`)
		expect(writes[0]?.content).toContain(
			"CREATE ROLE postgres_exporter WITH LOGIN PASSWORD 'alnumPass123'",
		)
	})
})
