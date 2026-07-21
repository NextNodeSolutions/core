import { describe, expect, it } from 'vitest'

import { buildMigrateCommand, buildSnapshotCommand } from './migrate.ts'

import type {
	ContainerMigrateInput,
	ImageRef,
	SnapshotInput,
} from '#/domain/deploy/target.ts'

const IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'nextnodesolutions/acme-web',
	tag: 'sha-abc1234',
}

const BASE_INPUT: ContainerMigrateInput = {
	kind: 'container',
	projectName: 'acme-web',
	image: IMAGE,
	migrateCommand: 'pnpm drizzle-kit migrate',
	environment: 'production',
}

describe('buildMigrateCommand', () => {
	it('renders the docker run command with shell-escaped fields', () => {
		const { command, fields } = buildMigrateCommand(BASE_INPUT)

		expect(command).toBe(
			"docker run --rm --network 'acme-web-production_default'" +
				" --env-file '/opt/apps/acme-web/production/.env'" +
				" 'ghcr.io/nextnodesolutions/acme-web:sha-abc1234'" +
				" sh -c 'pnpm drizzle-kit migrate'",
		)
		expect(fields).toEqual({
			network: 'acme-web-production_default',
			envFile: '/opt/apps/acme-web/production/.env',
			image: IMAGE,
			migrateCommand: 'pnpm drizzle-kit migrate',
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

const SNAPSHOT_INPUT: SnapshotInput = {
	projectName: 'acme-web',
	environment: 'production',
}

describe('buildSnapshotCommand', () => {
	it('renders the docker compose exec invocation against the backup sidecar', () => {
		const { command, fields } = buildSnapshotCommand(SNAPSHOT_INPUT)

		expect(command).toBe(
			"docker compose -p 'acme-web-production'" +
				" -f '/opt/apps/acme-web/production/compose.yaml'" +
				' exec -T postgres-backup sh backup.sh',
		)
		expect(fields).toEqual({
			composeFile: '/opt/apps/acme-web/production/compose.yaml',
			siloId: 'acme-web-production',
			serviceName: 'postgres-backup',
			script: 'backup.sh',
		})
	})

	it('derives the silo + compose path from the development environment', () => {
		const { command, fields } = buildSnapshotCommand({
			...SNAPSHOT_INPUT,
			environment: 'development',
		})

		expect(fields.siloId).toBe('acme-web-development')
		expect(fields.composeFile).toBe(
			'/opt/apps/acme-web/development/compose.yaml',
		)
		expect(command).toContain("-p 'acme-web-development'")
		expect(command).toContain(
			"-f '/opt/apps/acme-web/development/compose.yaml'",
		)
	})

	it('shell-escapes a malicious project name', () => {
		const { command } = buildSnapshotCommand({
			...SNAPSHOT_INPUT,
			projectName: 'acme;rm -rf /',
		})

		expect(command).toContain("-p 'acme;rm -rf /-production'")
		expect(command).toContain(
			"-f '/opt/apps/acme;rm -rf //production/compose.yaml'",
		)
	})

	it('uses `exec -T` so the sidecar runs without a pseudo-TTY', () => {
		const { command } = buildSnapshotCommand(SNAPSHOT_INPUT)

		expect(command).toMatch(/exec -T postgres-backup sh backup\.sh$/)
	})
})
