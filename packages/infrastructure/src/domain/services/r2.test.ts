import { describe, expect, it } from 'vitest'

import type { R2ServiceState } from './r2.ts'
import {
	buildR2ServiceEnv,
	computeR2BucketBindings,
	computeR2BucketName,
	r2ServiceStateKey,
	r2ServiceTokenName,
} from './r2.ts'

describe('computeR2BucketName', () => {
	it('joins project, environment, and alias with dashes', () => {
		expect(computeR2BucketName('myapp', 'production', 'uploads')).toBe(
			'myapp-production-uploads',
		)
	})

	it('keeps preview environments distinct from production', () => {
		expect(computeR2BucketName('myapp', 'development', 'uploads')).toBe(
			'myapp-development-uploads',
		)
	})
})

describe('computeR2BucketBindings', () => {
	it('maps each alias to a unique bucket name', () => {
		const bindings = computeR2BucketBindings('myapp', 'production', [
			'uploads',
			'media',
		])
		expect(bindings).toEqual([
			{ alias: 'uploads', name: 'myapp-production-uploads' },
			{ alias: 'media', name: 'myapp-production-media' },
		])
	})

	it('returns empty array when no aliases are declared', () => {
		expect(computeR2BucketBindings('myapp', 'production', [])).toEqual([])
	})
})

describe('r2ServiceTokenName', () => {
	it('namespaces the token by project + environment so rotations find prior tokens', () => {
		expect(r2ServiceTokenName('myapp', 'production')).toBe(
			'nextnode-r2-myapp-production',
		)
		expect(r2ServiceTokenName('myapp', 'development')).toBe(
			'nextnode-r2-myapp-development',
		)
	})
})

describe('r2ServiceStateKey', () => {
	it('uses a services/r2/<project>/<env>.json layout', () => {
		expect(r2ServiceStateKey('myapp', 'production')).toBe(
			'services/r2/myapp/production.json',
		)
	})
})

describe('buildR2ServiceEnv', () => {
	const STATE: R2ServiceState = {
		endpoint: 'https://acct.r2.cloudflarestorage.com',
		accessKeyId: 'access-key',
		secretAccessKey: 'secret-key',
		buckets: [
			{ alias: 'uploads', name: 'myapp-production-uploads' },
			{ alias: 'media-assets', name: 'myapp-production-media-assets' },
		],
	}

	it('exposes the endpoint as a public env var', () => {
		const env = buildR2ServiceEnv(STATE)
		expect(env.public['R2_ENDPOINT']).toBe(
			'https://acct.r2.cloudflarestorage.com',
		)
	})

	it('emits R2_BUCKET_<UPPER_ALIAS> for each bucket binding', () => {
		const env = buildR2ServiceEnv(STATE)
		expect(env.public['R2_BUCKET_UPLOADS']).toBe('myapp-production-uploads')
		expect(env.public['R2_BUCKET_MEDIA_ASSETS']).toBe(
			'myapp-production-media-assets',
		)
	})

	it('routes credentials into the secret channel, not the public env', () => {
		const env = buildR2ServiceEnv(STATE)
		expect(env.secret).toEqual({
			R2_ACCESS_KEY_ID: 'access-key',
			R2_SECRET_ACCESS_KEY: 'secret-key',
		})
		expect(env.public['R2_ACCESS_KEY_ID']).toBeUndefined()
		expect(env.public['R2_SECRET_ACCESS_KEY']).toBeUndefined()
	})
})
