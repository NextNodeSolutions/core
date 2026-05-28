import { describe, expect, it } from 'vitest'

import {
	SUPABASE_AUTH_IMAGE,
	SUPABASE_AUTH_SERVICE_NAME,
	SUPABASE_DASHBOARD_USERNAME,
	SUPABASE_DB_DATA_DIR,
	SUPABASE_DB_DATA_VOLUME,
	SUPABASE_DB_SERVICE_NAME,
	SUPABASE_DEFAULT_DATABASE,
	SUPABASE_JWT_EXPIRY_SECONDS,
	SUPABASE_KONG_HTTP_PORT,
	SUPABASE_KONG_IMAGE,
	SUPABASE_KONG_SERVICE_NAME,
	SUPABASE_POSTGRES_IMAGE,
	SUPABASE_REALTIME_IMAGE,
	SUPABASE_REALTIME_SERVICE_NAME,
	SUPABASE_STORAGE_IMAGE,
	SUPABASE_STORAGE_SERVICE_NAME,
	SUPABASE_STUDIO_IMAGE,
	SUPABASE_STUDIO_SERVICE_NAME,
	buildSupabaseBackupEnv,
	buildSupabaseStack,
} from './supabase.ts'

import type { R2ServiceState } from './r2.ts'

describe('supabase image pins', () => {
	it('pins the supabase/postgres image to a PG 17 release line', () => {
		expect(SUPABASE_POSTGRES_IMAGE).toMatch(
			/^supabase\/postgres:17\.\d+\.\d+\.\d+$/,
		)
	})

	it('pins the supabase/gotrue (auth) image to a tagged release', () => {
		expect(SUPABASE_AUTH_IMAGE).toMatch(/^supabase\/gotrue:v\d+\.\d+\.\d+$/)
	})

	it('pins the supabase/realtime image to a tagged release', () => {
		expect(SUPABASE_REALTIME_IMAGE).toMatch(
			/^supabase\/realtime:v\d+\.\d+\.\d+$/,
		)
	})

	it('pins the supabase/storage-api image to a tagged release', () => {
		expect(SUPABASE_STORAGE_IMAGE).toMatch(
			/^supabase\/storage-api:v\d+\.\d+\.\d+$/,
		)
	})

	it('pins the kong/kong image to a tagged release', () => {
		expect(SUPABASE_KONG_IMAGE).toMatch(/^kong\/kong:\d+\.\d+\.\d+$/)
	})

	it('pins the supabase/studio image to a dated build tag', () => {
		expect(SUPABASE_STUDIO_IMAGE).toMatch(
			/^supabase\/studio:\d{4}\.\d{2}\.\d{2}-sha-[0-9a-f]+$/,
		)
	})
})

describe('supabase static config defaults', () => {
	it('pins KONG_HTTP_PORT to the upstream supabase compose default so Caddy and kong agree', () => {
		expect(SUPABASE_KONG_HTTP_PORT).toBe(8000)
	})

	it('pins JWT_EXPIRY to the upstream supabase compose default (1h)', () => {
		expect(SUPABASE_JWT_EXPIRY_SECONDS).toBe(3600)
	})

	it('pins the dashboard admin username to the upstream supabase compose default', () => {
		expect(SUPABASE_DASHBOARD_USERNAME).toBe('supabase')
	})
})

describe('supabase service names', () => {
	it('uses the upstream supabase compose convention for the database service', () => {
		expect(SUPABASE_DB_SERVICE_NAME).toBe('db')
	})

	it('defaults the database name to the supabase initdb target', () => {
		expect(SUPABASE_DEFAULT_DATABASE).toBe('postgres')
	})

	it('mounts the postgres data dir at the upstream image default path', () => {
		expect(SUPABASE_DB_DATA_DIR).toBe('/var/lib/postgresql/data')
	})

	it('names the supabase db named volume distinctly from the embedded postgres volume', () => {
		expect(SUPABASE_DB_DATA_VOLUME).toBe('supabase-db-data')
	})
})

describe('buildSupabaseStack', () => {
	it('renders the six self-host services in upstream-compose order', () => {
		expect(Object.keys(buildSupabaseStack())).toEqual([
			'db',
			'auth',
			'realtime',
			'storage',
			'kong',
			'studio',
		])
	})

	it('pins each service to its module-level image constant', () => {
		const stack = buildSupabaseStack()

		expect(stack[SUPABASE_DB_SERVICE_NAME]?.image).toBe(
			SUPABASE_POSTGRES_IMAGE,
		)
		expect(stack[SUPABASE_AUTH_SERVICE_NAME]?.image).toBe(
			SUPABASE_AUTH_IMAGE,
		)
		expect(stack[SUPABASE_REALTIME_SERVICE_NAME]?.image).toBe(
			SUPABASE_REALTIME_IMAGE,
		)
		expect(stack[SUPABASE_STORAGE_SERVICE_NAME]?.image).toBe(
			SUPABASE_STORAGE_IMAGE,
		)
		expect(stack[SUPABASE_KONG_SERVICE_NAME]?.image).toBe(
			SUPABASE_KONG_IMAGE,
		)
		expect(stack[SUPABASE_STUDIO_SERVICE_NAME]?.image).toBe(
			SUPABASE_STUDIO_IMAGE,
		)
	})

	it('configures every service with restart=unless-stopped and the shared .env file', () => {
		const stack = buildSupabaseStack()

		for (const service of Object.values(stack)) {
			expect(service.restart).toBe('unless-stopped')
			expect(service.env_file).toEqual(['.env'])
		}
	})

	it('persists the db data dir through a named volume mount', () => {
		expect(buildSupabaseStack()[SUPABASE_DB_SERVICE_NAME]?.volumes).toEqual(
			[`${SUPABASE_DB_DATA_VOLUME}:${SUPABASE_DB_DATA_DIR}`],
		)
	})

	it('mounts no volume on services other than db', () => {
		const stack = buildSupabaseStack()
		const otherServices = [
			SUPABASE_AUTH_SERVICE_NAME,
			SUPABASE_REALTIME_SERVICE_NAME,
			SUPABASE_STORAGE_SERVICE_NAME,
			SUPABASE_KONG_SERVICE_NAME,
			SUPABASE_STUDIO_SERVICE_NAME,
		]

		for (const name of otherServices) {
			expect(stack[name]?.volumes).toBeUndefined()
		}
	})

	it('declares auth, realtime, storage, and kong as depending on db', () => {
		const stack = buildSupabaseStack()

		expect(stack[SUPABASE_AUTH_SERVICE_NAME]?.depends_on).toEqual([
			SUPABASE_DB_SERVICE_NAME,
		])
		expect(stack[SUPABASE_REALTIME_SERVICE_NAME]?.depends_on).toEqual([
			SUPABASE_DB_SERVICE_NAME,
		])
		expect(stack[SUPABASE_STORAGE_SERVICE_NAME]?.depends_on).toEqual([
			SUPABASE_DB_SERVICE_NAME,
		])
		expect(stack[SUPABASE_KONG_SERVICE_NAME]?.depends_on).toEqual([
			SUPABASE_DB_SERVICE_NAME,
		])
	})

	it('omits depends_on on db (the root service) and studio (talks via kong)', () => {
		const stack = buildSupabaseStack()

		expect(stack[SUPABASE_DB_SERVICE_NAME]?.depends_on).toBeUndefined()
		expect(stack[SUPABASE_STUDIO_SERVICE_NAME]?.depends_on).toBeUndefined()
	})

	it('produces deterministic output - two calls return equal stacks', () => {
		expect(buildSupabaseStack()).toEqual(buildSupabaseStack())
	})
})

describe('buildSupabaseBackupEnv', () => {
	const STATE: R2ServiceState = {
		endpoint: 'https://acct.r2.cloudflarestorage.com',
		accessKeyId: 'ak-XXXX',
		secretAccessKey: 'sk-YYYY',
		buckets: [
			{ alias: 'uploads', name: 'myapp-production-uploads' },
			{ alias: 'backups', name: 'myapp-production-backups' },
		],
	}

	it('maps the R2 state credentials + endpoint onto the four BACKUP_R2_* env vars', () => {
		expect(buildSupabaseBackupEnv(STATE)).toEqual({
			BACKUP_R2_ACCESS_KEY_ID: 'ak-XXXX',
			BACKUP_R2_SECRET_ACCESS_KEY: 'sk-YYYY',
			BACKUP_R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
			BACKUP_R2_BUCKET: 'myapp-production-backups',
		})
	})

	it('throws when the state has no "backups" alias — the supabase sidecar would have no bucket to upload to', () => {
		expect(() =>
			buildSupabaseBackupEnv({
				...STATE,
				buckets: [{ alias: 'uploads', name: 'myapp-uploads' }],
			}),
		).toThrow(/missing the "backups" bucket alias/)
	})

	it('throws when the state has no buckets at all', () => {
		expect(() => buildSupabaseBackupEnv({ ...STATE, buckets: [] })).toThrow(
			/missing the "backups" bucket alias/,
		)
	})

	it('selects the backups binding regardless of its position in the list', () => {
		const env = buildSupabaseBackupEnv({
			...STATE,
			buckets: [
				{ alias: 'backups', name: 'first-bucket' },
				{ alias: 'uploads', name: 'second-bucket' },
			],
		})

		expect(env['BACKUP_R2_BUCKET']).toBe('first-bucket')
	})
})
