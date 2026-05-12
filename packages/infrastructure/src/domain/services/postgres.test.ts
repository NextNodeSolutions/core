import { describe, expect, it } from 'vitest'

import {
	POSTGRES_DATA_DIR,
	POSTGRES_DATA_VOLUME,
	buildPostgresSidecar,
} from './postgres.ts'

describe('buildPostgresSidecar', () => {
	it('returns a sidecar spec when mode is embedded', () => {
		const result = buildPostgresSidecar({
			mode: 'embedded',
			version: '17.2',
		})

		expect(result).not.toBeNull()
		if (result === null) return
		expect(result.image).toBe('postgres:17.2')
		expect(result.restart).toBe('unless-stopped')
		expect(result.env_file).toEqual(['.env'])
		expect(result.volumes).toEqual([
			`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`,
		])
		expect(result.healthcheck.test).toEqual([
			'CMD-SHELL',
			'pg_isready -U postgres',
		])
	})

	it('returns null when mode is external', () => {
		const result = buildPostgresSidecar({
			mode: 'external',
			version: '16',
		})

		expect(result).toBeNull()
	})

	it('threads the major-only version into the image tag', () => {
		const result = buildPostgresSidecar({
			mode: 'embedded',
			version: '16',
		})

		expect(result?.image).toBe('postgres:16')
	})
})
