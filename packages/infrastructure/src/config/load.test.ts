import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig, parseConfig } from './load.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const fixture = (name: string): string => join(FIXTURES, name)

describe('loadConfig', () => {
	it('loads a minimal valid config with defaults', () => {
		const config = loadConfig(fixture('valid.toml'))

		expect(config.project.name).toBe('my-app')
		expect(config.project.type).toBe('app')
		expect(config.scripts.lint).toBe('lint')
		expect(config.scripts.test).toBe('test')
		expect(config.scripts.build).toBe('build')
	})

	it('loads a monorepo package config with filter and package section', () => {
		const config = loadConfig(fixture('monorepo-package.toml'))

		expect(config.project.name).toBe('logger')
		expect(config.project.filter).toBe('@nextnode-solutions/logger')
		expect(config.package).toEqual({ access: 'public' })
	})

	it('defaults filter to false when not specified', () => {
		const config = loadConfig(fixture('valid.toml'))

		expect(config.project.filter).toBe(false)
	})

	it('allows overriding scripts', () => {
		const config = loadConfig(fixture('custom-scripts.toml'))

		expect(config.scripts.lint).toBe('check')
		expect(config.scripts.test).toBe(false)
		expect(config.scripts.build).toBe('build')
	})

	it('throws with all validation errors listed in message', () => {
		expect(() => loadConfig(fixture('empty.toml'))).toThrow(
			'Invalid nextnode.toml:\n  - [project] section is required',
		)
	})

	it('throws ENOENT error for missing file', () => {
		expect(() => loadConfig('/nonexistent/nextnode.toml')).toThrow('ENOENT')
	})

	it('throws on invalid TOML syntax', () => {
		expect(() => loadConfig(fixture('invalid-syntax.toml'))).toThrow(
			'Invalid TOML document',
		)
	})

	it('defaults environment.development to true when not in TOML', () => {
		const config = loadConfig(fixture('valid.toml'))

		expect(config.environment.development).toBe(true)
	})

	it('reads environment.development = false from TOML', () => {
		const config = loadConfig(fixture('dev-disabled.toml'))

		expect(config.environment.development).toBe(false)
	})

	it('loads a config with a full [monitoring] section', () => {
		const config = loadConfig(fixture('with-monitoring.toml'))

		if (config.monitoring === false) {
			expect.unreachable('monitoring should be defined')
		}
		expect(config.monitoring.endpoint).toBe(
			'https://monitoring.nextnode.fr',
		)
		expect(config.monitoring.slo).toEqual({
			availability: 99.9,
			latencyMsP95: 500,
			latencyMsP99: 1500,
			windowDays: 30,
		})
		expect(config.monitoring.healthcheck).toEqual({
			path: '/api/health',
			intervalSeconds: 10,
			timeoutMs: 3000,
			expectedStatus: 204,
		})
	})

	it('defaults monitoring to false when section is absent', () => {
		const config = loadConfig(fixture('valid.toml'))

		expect(config.monitoring).toBe(false)
	})
})

describe('parseConfig', () => {
	describe('valid configs', () => {
		it('parses a valid app config with script defaults', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
				},
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
			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
			})
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
				project: { name: 'test', type: 'package' },
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
				project: { name: 'my-app', type: 'package' },
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

			expect(result.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining('project.type is required'),
				]),
			)
		})

		it('rejects invalid project.type', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'service' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining('project.type is required'),
				]),
			)
		})
	})

	describe('invalid values', () => {
		it('collects errors across all sections at once', () => {
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
			expect(result.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining('project.type is required'),
				]),
			)
			expect(result.errors).toContain(
				'scripts.lint must be a string or false, got number',
			)
		})

		it('rejects non-string non-false script values', () => {
			const result = parseConfig({
				project: { name: 'test', type: 'package' },
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
				project: { name: 'my-app', type: 'package' },
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
				project: { name: 'my-app', type: 'package', filter: false },
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
				project: { name: 'my-app', type: 'package' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.environment.development).toBe(true)
		})

		it('accepts development set to true', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'package' },
				environment: { development: true },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.environment.development).toBe(true)
		})

		it('accepts development set to false', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'package' },
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
				project: { name: 'my-app', type: 'package' },
				environment: { development: true, unknown_key: 'whatever' },
			})

			expect(result.ok).toBe(true)
		})
	})

	describe('project.domain', () => {
		it('defaults domain to undefined when not provided', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.domain).toBeUndefined()
		})

		it('accepts a non-empty string domain', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.domain).toBe('example.com')
		})

		it('rejects empty-string domain', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static', domain: '' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.domain must be a non-empty string',
			)
		})

		it('rejects non-string domain', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static', domain: 42 },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.domain must be a non-empty string',
			)
		})
	})

	describe('project.redirect_domains', () => {
		it('defaults redirect_domains to empty array when not provided', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.redirectDomains).toEqual([])
		})

		it('accepts an array of domain strings', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
					redirect_domains: ['example.fr', 'example.net'],
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.redirectDomains).toEqual([
				'example.fr',
				'example.net',
			])
		})

		it('rejects non-array redirect_domains', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					redirect_domains: 'example.fr',
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.redirect_domains must be an array of strings',
			)
		})

		it('rejects empty-string entries', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					redirect_domains: ['example.fr', ''],
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.redirect_domains entries must be non-empty strings',
			)
		})

		it('rejects non-string entries', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					redirect_domains: ['example.fr', 42],
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.redirect_domains entries must be non-empty strings',
			)
		})
	})

	describe('project.internal', () => {
		it('defaults internal to false when not provided', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'package' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.internal).toBe(false)
		})

		it('accepts internal set to true', () => {
			const result = parseConfig({
				project: {
					name: 'monitor',
					type: 'app',
					domain: 'monitor.nextnode.fr',
					internal: true,
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.internal).toBe(true)
		})

		it('accepts internal set to false', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
					internal: false,
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.internal).toBe(false)
		})

		it('rejects non-boolean internal value', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
					internal: 'yes',
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.internal must be a boolean',
			)
		})

		it('rejects internal with cloudflare-pages target', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					internal: true,
				},
				deploy: { target: 'cloudflare-pages' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.internal is not supported with deploy target "cloudflare-pages"',
			)
		})

		it('rejects internal with inferred cloudflare-pages target', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					internal: true,
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.internal is not supported with deploy target "cloudflare-pages"',
			)
		})

		it('accepts internal with hetzner-vps target', () => {
			const result = parseConfig({
				project: {
					name: 'monitor',
					type: 'app',
					domain: 'monitor.nextnode.fr',
					internal: true,
				},
				deploy: {
					target: 'hetzner-vps',
					hetzner: { server_type: 'cx23', location: 'nbg1' },
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.project.internal).toBe(true)
			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cx23', location: 'nbg1' },
			})
		})
	})

	describe('deploy section', () => {
		it('defaults to cloudflare-pages with empty secrets for static projects', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: [],
				hetzner: undefined,
			})
		})

		it('accepts an array of secret names', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'static' },
				deploy: { secrets: ['RESEND_API_KEY', 'SUPABASE_URL'] },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: ['RESEND_API_KEY', 'SUPABASE_URL'],
				hetzner: undefined,
			})
		})

		it('rejects non-array secrets', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: { secrets: 'RESEND_API_KEY' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'deploy.secrets must be an array of strings',
			)
		})

		it('rejects empty-string entries', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: { secrets: ['RESEND_API_KEY', ''] },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'deploy.secrets entries must be non-empty strings',
			)
		})
	})

	describe('deploy target', () => {
		it('infers hetzner-vps for app type with valid hetzner config', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
			})
		})

		it('infers cloudflare-pages for static type', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: [],
				hetzner: undefined,
			})
		})

		it('accepts explicit target override for app', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				deploy: { target: 'cloudflare-pages' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: [],
				hetzner: undefined,
			})
		})

		it('accepts explicit hetzner-vps target for static with hetzner config', () => {
			const result = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'my-site.example.com',
				},
				deploy: {
					target: 'hetzner-vps',
					hetzner: { server_type: 'cax11', location: 'fsn1' },
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cax11', location: 'fsn1' },
			})
		})

		it('defaults hetzner config when app has no deploy section', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cx23', location: 'nbg1' },
			})
		})

		it('defaults hetzner config when deploy section omits it', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { target: 'hetzner-vps' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cx23', location: 'nbg1' },
			})
		})

		it('defaults individual hetzner fields when partially specified', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { hetzner: { server_type: 'cpx22' } },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
			})
		})

		it('rejects hetzner-vps without project.domain', () => {
			const result = parseConfig({
				project: { name: 'my-app', type: 'app' },
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'project.domain is required when deploy target is "hetzner-vps"',
			)
		})

		it('rejects invalid hetzner field values', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: '', location: 42 },
				},
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'deploy.hetzner.server_type must be a non-empty string',
			)
			expect(result.errors).toContain(
				'deploy.hetzner.location must be a non-empty string',
			)
		})

		it('rejects non-table hetzner section', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { hetzner: 'invalid' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain('[deploy.hetzner] must be a table')
		})

		it('rejects invalid deploy target string', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: { target: 'aws-ecs' },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'deploy.target must be one of: hetzner-vps, cloudflare-pages',
			)
		})

		it('rejects [deploy] section for package type', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				deploy: { secrets: ['DB_URL'] },
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain(
				'[deploy] section is forbidden for project type "package"',
			)
		})

		it('sets deploy to false for package type without deploy section', () => {
			const result = parseConfig({
				project: { name: 'my-lib', type: 'package' },
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toBe(false)
		})

		it('rejects non-table deploy section', () => {
			const result = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: 'invalid',
			})

			expect(result.ok).toBe(false)
			if (result.ok) return

			expect(result.errors).toContain('[deploy] must be a table')
		})

		it('includes secrets with hetzner-vps deploy', () => {
			const result = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					secrets: ['DATABASE_URL', 'REDIS_URL'],
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
				},
			})

			expect(result.ok).toBe(true)
			if (!result.ok) return

			expect(result.config.deploy).toEqual({
				target: 'hetzner-vps',
				secrets: ['DATABASE_URL', 'REDIS_URL'],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
			})
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
				project: { name: 'test', type: 'package' },
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
