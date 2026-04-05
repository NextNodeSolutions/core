import { describe, expect, it } from 'vitest'

import { parseConfig } from './schema.js'

describe('parseConfig', () => {
	describe('valid configs', () => {
		it('parses a valid app config with script defaults', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.name).toBe('my-app')
			expect(result.config.project.type).toBe('app')
			expect(result.config.project.filter).toBe(false)
			expect(result.config.scripts.lint).toBe('lint')
			expect(result.config.scripts.test).toBe('test')
			expect(result.config.scripts.build).toBe('build')
			expect(result.config.package).toBe(false)
		})

		it('parses a valid package config', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.type).toBe('package')
		})

		it('accepts scripts set to false', () => {
			const result = parseConfig({
				project: { name: 'test', type: 'app' },
				scripts: { lint: false, test: false, build: false },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.scripts.lint).toBe(false)
			expect(result.config.scripts.test).toBe(false)
			expect(result.config.scripts.build).toBe(false)
		})

		it('uses custom script names when provided', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				scripts: { lint: 'check:lint', test: 'check:test' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.scripts.lint).toBe('check:lint')
			expect(result.config.scripts.test).toBe('check:test')
			expect(result.config.scripts.build).toBe('build')
		})
	})

	describe('missing required fields', () => {
		it('rejects missing project section', () => {
			const result = parseConfig({})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toEqual(['[project] section is required'])
		})

		it('rejects missing project.name', () => {
			const result = parseConfig({ project: { type: 'app' } })

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.name is required and must be a string',
			)
		})

		it('rejects missing project.type', () => {
			const result = parseConfig({ project: { name: 'my-app' } })

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.type is required and must be one of: app, package, static',
			)
		})

		it('rejects invalid project.type', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'service' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.type is required and must be one of: app, package, static',
			)
		})
	})

	describe('invalid values', () => {
		it('collects multiple errors at once', () => {
			const result = parseConfig({
				project: {},
				scripts: { lint: 42 },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toHaveLength(3)
			expect(result.errors).toContain(
				'project.name is required and must be a string',
			)
			expect(result.errors).toContain(
				'project.type is required and must be one of: app, package, static',
			)
			expect(result.errors).toContain(
				'scripts.lint must be a string or false, got number',
			)
		})

		it('rejects non-string non-false script values', () => {
			const result = parseConfig({
				project: { name: 'test', type: 'app' },
				scripts: { lint: 42 },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toEqual([
				'scripts.lint must be a string or false, got number',
			])
		})

		it('rejects empty string project.name', () => {
			const result = parseConfig({ project: { name: '', type: 'app' } })

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.name is required and must be a string',
			)
		})
	})

	describe('project.filter', () => {
		it('defaults filter to false when not provided', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.filter).toBe(false)
		})

		it('accepts a string filter', () => {
			const result = parseConfig({
				project: {
					name: 'logger',
					type: 'package',
					filter: '@nextnode-solutions/logger',
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.filter).toBe(
				'@nextnode-solutions/logger',
			)
		})

		it('accepts false to explicitly disable filter', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app', filter: false },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.filter).toBe(false)
		})

		it('rejects non-string non-false filter values', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app', filter: 42 },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.filter must be a string or false',
			)
		})
	})

	describe('package section', () => {
		it('defaults package to false when not provided', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.package).toBe(false)
		})

		it('parses package section with access', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				package: { access: 'public' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.package).toEqual({ access: 'public' })
		})

		it('rejects package section without access', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				package: {},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'package.access is required and must be a string',
			)
		})

		it('rejects non-string access', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				package: { access: 42 },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'package.access is required and must be a string',
			)
		})
	})

	describe('environment', () => {
		it('defaults development to true when environment section not provided', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.environment.development).toBe(true)
		})

		it('accepts development set to true', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				environment: { development: true },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.environment.development).toBe(true)
		})

		it('accepts development set to false', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				environment: { development: false },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.environment.development).toBe(false)
		})

		it('rejects non-boolean development value', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				environment: { development: 'yes' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'environment.development must be a boolean',
			)
		})

		it('ignores unknown environment keys without error', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				environment: { development: true, unknown_key: 'whatever' },
			})

			expect(result.ok).toBe(true)
		})
	})

	describe('static project type', () => {
		it('parses a valid static config', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.type).toBe('static')
		})
	})

	describe('edge cases', () => {
		it('ignores unknown script keys without error', () => {
			const result = parseConfig({
				project: { name: 'test', type: 'app' },
				scripts: { lint: 'lint', unknown_key: 'whatever' },
			})

			expect(result.ok).toBe(true)
		})

		it('handles undefined scripts section by using defaults', () => {
			const result = parseConfig({
				project: { name: 'test', type: 'package' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.scripts).toEqual({
				lint: 'lint',
				test: 'test',
				build: 'build',
			})
		})
	})
})
