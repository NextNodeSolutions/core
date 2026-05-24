import type { ImageRef, MigrateInput } from '#/domain/deploy/target.ts'
import { describe, expect, it } from 'vitest'

import { buildMigrateCommand } from './migrate.ts'

const IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'nextnodesolutions/acme-web',
	tag: 'sha-abc1234',
}

const BASE_INPUT: MigrateInput = {
	projectName: 'acme-web',
	image: IMAGE,
	migrateCommand: 'node scripts/migrate.js',
	environment: 'production',
}

describe('buildMigrateCommand', () => {
	it('renders the docker run command with shell-escaped fields', () => {
		const { command, fields } = buildMigrateCommand(BASE_INPUT)

		expect(command).toBe(
			"docker run --rm --network 'acme-web-production_default'" +
				" --env-file '/opt/apps/acme-web/production/.env'" +
				" 'ghcr.io/nextnodesolutions/acme-web:sha-abc1234'" +
				" sh -c 'node scripts/migrate.js'",
		)
		expect(fields).toEqual({
			network: 'acme-web-production_default',
			envFile: '/opt/apps/acme-web/production/.env',
			image: IMAGE,
			migrateCommand: 'node scripts/migrate.js',
		})
	})

	it('derives the network name from the silo for development environment', () => {
		const { fields } = buildMigrateCommand({
			...BASE_INPUT,
			environment: 'development',
		})

		expect(fields.network).toBe('acme-web-development_default')
		expect(fields.envFile).toBe('/opt/apps/acme-web/development/.env')
	})

	it('passes through a custom migrate command for non-Drizzle stacks', () => {
		const { command, fields } = buildMigrateCommand({
			...BASE_INPUT,
			migrateCommand: 'pnpm prisma migrate deploy',
		})

		expect(fields.migrateCommand).toBe('pnpm prisma migrate deploy')
		expect(command).toContain("sh -c 'pnpm prisma migrate deploy'")
	})

	it('shell-escapes a migrate command that contains single quotes', () => {
		const { command } = buildMigrateCommand({
			...BASE_INPUT,
			migrateCommand: "sh -c 'echo 1'",
		})

		expect(command).toContain("sh -c 'sh -c '\\''echo 1'\\'''")
	})

	it('escapes shell metacharacters in the project name', () => {
		const { command } = buildMigrateCommand({
			...BASE_INPUT,
			projectName: 'acme;rm -rf /',
		})

		expect(command).toContain(
			"--network 'acme;rm -rf /-production_default'",
		)
		expect(command).toContain(
			"--env-file '/opt/apps/acme;rm -rf //production/.env'",
		)
	})

	it('renders the image as registry/repository:tag inside single quotes', () => {
		const { command } = buildMigrateCommand({
			...BASE_INPUT,
			image: {
				registry: 'docker.io',
				repository: 'library/postgres',
				tag: '18',
			},
		})

		expect(command).toContain("'docker.io/library/postgres:18'")
	})
})
