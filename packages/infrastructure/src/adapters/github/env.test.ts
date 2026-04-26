import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeEnvVar, writeSecret } from './env.ts'

describe('writeEnvVar', () => {
	let envFile: string
	const originalEnv = process.env['GITHUB_ENV']

	beforeEach(() => {
		envFile = join(
			tmpdir(),
			`gh-env-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
		)
		process.env['GITHUB_ENV'] = envFile
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env['GITHUB_ENV']
		} else {
			process.env['GITHUB_ENV'] = originalEnv
		}
		rmSync(envFile, { force: true })
		vi.restoreAllMocks()
	})

	it('appends key=value to GITHUB_ENV file', () => {
		writeEnvVar('SITE_URL', 'https://example.com')

		const output = readFileSync(envFile, 'utf-8')
		expect(output).toBe('SITE_URL=https://example.com\n')
	})

	it('appends multiple env vars', () => {
		writeEnvVar('SITE_URL', 'https://example.com')
		writeEnvVar('API_KEY', 'secret-123')

		const output = readFileSync(envFile, 'utf-8')
		expect(output).toBe(
			'SITE_URL=https://example.com\nAPI_KEY=secret-123\n',
		)
	})

	it('throws when GITHUB_ENV is not set', () => {
		delete process.env['GITHUB_ENV']

		expect(() => writeEnvVar('KEY', 'value')).toThrow(
			'GITHUB_ENV env var is not set',
		)
	})
})

describe('writeSecret', () => {
	let envFile: string
	const originalEnv = process.env['GITHUB_ENV']
	const writes: string[] = []

	beforeEach(() => {
		envFile = join(
			tmpdir(),
			`gh-env-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
		)
		process.env['GITHUB_ENV'] = envFile
		writes.length = 0
		vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
			writes.push(
				typeof chunk === 'string'
					? chunk
					: Buffer.from(chunk).toString(),
			)
			return true
		})
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env['GITHUB_ENV']
		} else {
			process.env['GITHUB_ENV'] = originalEnv
		}
		rmSync(envFile, { force: true })
		vi.restoreAllMocks()
	})

	it('emits ::add-mask:: for the value before writing to GITHUB_ENV', () => {
		writeSecret('R2_SECRET_ACCESS_KEY', 'super-secret')

		expect(writes).toEqual(['::add-mask::super-secret\n'])
		const output = readFileSync(envFile, 'utf-8')
		expect(output).toBe('R2_SECRET_ACCESS_KEY=super-secret\n')
	})

	it('masks each secret independently when called multiple times', () => {
		writeSecret('A', 'aaa')
		writeSecret('B', 'bbb')

		expect(writes).toEqual(['::add-mask::aaa\n', '::add-mask::bbb\n'])
		const output = readFileSync(envFile, 'utf-8')
		expect(output).toBe('A=aaa\nB=bbb\n')
	})

	it('throws when GITHUB_ENV is not set', () => {
		delete process.env['GITHUB_ENV']

		expect(() => writeSecret('KEY', 'value')).toThrow(
			'GITHUB_ENV env var is not set',
		)
	})
})
