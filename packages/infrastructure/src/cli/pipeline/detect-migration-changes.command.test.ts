import { execFileSync } from 'node:child_process'
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { detectMigrationChangesCommand } from './detect-migration-changes.command.ts'

import type { NextNodeConfig } from '#/config/types.ts'

const POSTGRES_CONFIG: NextNodeConfig = {
	project: {
		name: 'my-app',
		type: 'app',
		filter: false,
		domain: 'my-app.example.com',
		redirectDomains: [],
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: false },
	deploy: false,
	services: { postgres: { mode: 'embedded' } },
}

const D1_CONFIG: NextNodeConfig = {
	...POSTGRES_CONFIG,
	services: { d1: { migrationsFolder: 'drizzle' } },
}

const gitEnv = {
	...process.env,
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@example.com',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@example.com',
}

const git = (args: ReadonlyArray<string>, cwd: string): string =>
	execFileSync('git', [...args], {
		cwd,
		encoding: 'utf-8',
		env: gitEnv,
	}).trim()

// Build a two-commit repo. The first commit seeds a migration + a source file;
// the second touches either the migrations folder or only source, returning the
// base/head shas of the resulting push range.
function makeRepo(touch: 'migration' | 'source'): {
	dir: string
	baseSha: string
	headSha: string
} {
	const dir = mkdtempSync(join(tmpdir(), 'detect-mig-'))
	git(['init', '-b', 'main'], dir)
	mkdirSync(join(dir, 'drizzle'))
	writeFileSync(join(dir, 'drizzle', '0000_init.sql'), 'create table a();')
	writeFileSync(join(dir, 'src.ts'), 'export const a = 1')
	git(['add', '-A'], dir)
	git(['commit', '-m', 'base'], dir)
	const baseSha = git(['rev-parse', 'HEAD'], dir)

	if (touch === 'migration') {
		writeFileSync(
			join(dir, 'drizzle', '0001_next.sql'),
			'create table b();',
		)
	} else {
		writeFileSync(join(dir, 'src.ts'), 'export const a = 2')
	}
	git(['add', '-A'], dir)
	git(['commit', '-m', 'change'], dir)
	const headSha = git(['rev-parse', 'HEAD'], dir)

	return { dir, baseSha, headSha }
}

describe('detectMigrationChangesCommand', () => {
	let outputFile: string
	const repos: string[] = []

	beforeEach(() => {
		const id = `${process.hrtime.bigint()}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		writeFileSync(outputFile, '')
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
		vi.stubEnv('GITHUB_EVENT_NAME', 'push')
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		for (const dir of repos) rmSync(dir, { recursive: true, force: true })
		repos.length = 0
		vi.unstubAllEnvs()
	})

	const stubRange = (repo: {
		dir: string
		baseSha: string
		headSha: string
	}): void => {
		repos.push(repo.dir)
		vi.stubEnv('GITHUB_WORKSPACE', repo.dir)
		vi.stubEnv('PIPELINE_BASE_SHA', repo.baseSha)
		vi.stubEnv('GITHUB_SHA', repo.headSha)
	}

	it('emits migrations_changed=true when the push touched the migrations folder', () => {
		stubRange(makeRepo('migration'))

		detectMigrationChangesCommand(POSTGRES_CONFIG)

		expect(readFileSync(outputFile, 'utf-8')).toContain(
			'migrations_changed=true\n',
		)
	})

	it('reads the migrations folder from [services.d1] for a Workers project', () => {
		stubRange(makeRepo('migration'))

		detectMigrationChangesCommand(D1_CONFIG)

		expect(readFileSync(outputFile, 'utf-8')).toContain(
			'migrations_changed=true\n',
		)
	})

	it('emits migrations_changed=false when the push touched no migration file', () => {
		stubRange(makeRepo('source'))

		detectMigrationChangesCommand(POSTGRES_CONFIG)

		expect(readFileSync(outputFile, 'utf-8')).toContain(
			'migrations_changed=false\n',
		)
	})

	it('fails safe to true on a manual dispatch (no diffable range)', () => {
		vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch')

		detectMigrationChangesCommand(POSTGRES_CONFIG)

		expect(readFileSync(outputFile, 'utf-8')).toContain(
			'migrations_changed=true\n',
		)
	})

	it('fails safe to true when the base sha is the zero ref (first push / new branch)', () => {
		vi.stubEnv(
			'PIPELINE_BASE_SHA',
			'0000000000000000000000000000000000000000',
		)
		vi.stubEnv('GITHUB_SHA', 'deadbeef')
		vi.stubEnv('GITHUB_WORKSPACE', tmpdir())

		detectMigrationChangesCommand(POSTGRES_CONFIG)

		expect(readFileSync(outputFile, 'utf-8')).toContain(
			'migrations_changed=true\n',
		)
	})

	it('fails safe to true when git cannot diff the range (unknown base in a shallow clone)', () => {
		const repo = makeRepo('migration')
		repos.push(repo.dir)
		vi.stubEnv('GITHUB_WORKSPACE', repo.dir)
		vi.stubEnv(
			'PIPELINE_BASE_SHA',
			'ffffffffffffffffffffffffffffffffffffffff',
		)
		vi.stubEnv('GITHUB_SHA', repo.headSha)

		detectMigrationChangesCommand(POSTGRES_CONFIG)

		expect(readFileSync(outputFile, 'utf-8')).toContain(
			'migrations_changed=true\n',
		)
	})
})
