import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig, parseConfig } from './load.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const fixture = (name: string): string => join(FIXTURES, name)

const appConfig = (
	services: Record<string, unknown>,
): Record<string, unknown> => ({
	project: {
		name: 'my-app',
		type: 'app',
		domain: 'example.com',
	},
	deploy: { services },
})

const workersConfig = (
	services: Record<string, unknown>,
	deployExtra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	project: { name: 'my-worker', type: 'app', domain: 'example.com' },
	deploy: {
		target: 'cloudflare-workers',
		services,
		...deployExtra,
	},
})

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

	it('parses a [deploy.services.app] sub-table from TOML', () => {
		const config = loadConfig(fixture('deploy-services-app.toml'))

		if (config.deploy === false || config.deploy.target !== 'hetzner-vps') {
			throw new Error('expected a hetzner-vps deploy section')
		}

		expect(config.deploy.services).toEqual({
			app: {
				port: 3000,
				url: 'example.com',
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
			},
		})
	})
})

describe('parseConfig', () => {
	describe('valid configs', () => {
		it('parses a valid app config with script defaults', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.name).toBe('my-app')
			expect(parsed.config.project.type).toBe('app')
			expect(parsed.config.project.filter).toBe(false)
			expect(parsed.config.scripts.lint).toBe('lint')
			expect(parsed.config.scripts.test).toBe('test')
			expect(parsed.config.scripts.build).toBe('build')
			expect(parsed.config.package).toBe(false)
			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('parses a cloudflare-workers app with a service and domain', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-worker',
					type: 'app',
					domain: 'example.com',
				},
				deploy: {
					target: 'cloudflare-workers',
					services: { web: { url: 'example.com' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'cloudflare-workers',
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				cron: [],
				services: {
					web: {
						url: 'example.com',
						secrets: [],
						needs: [],
						dependsOn: [],
						entry: 'dist/_worker.js/index.js',
					},
				},
			})
		})

		it('still infers hetzner-vps for an app with no explicit target', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'example.com',
				},
				deploy: { services: { app: { source: 'build' } } },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return
			if (parsed.config.deploy === false) {
				expect.unreachable('expected a deploy section')
				return
			}
			expect(parsed.config.deploy.target).toBe('hetzner-vps')
		})

		it('parses a valid package config', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.type).toBe('package')
		})

		it('accepts scripts set to false', () => {
			const parsed = parseConfig({
				project: { name: 'test', type: 'package' },
				scripts: { lint: false, test: false, build: false },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.scripts.lint).toBe(false)
			expect(parsed.config.scripts.test).toBe(false)
			expect(parsed.config.scripts.build).toBe(false)
		})

		it('uses custom script names when provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
				scripts: { lint: 'check:lint', test: 'check:test' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.scripts.lint).toBe('check:lint')
			expect(parsed.config.scripts.test).toBe('check:test')
			expect(parsed.config.scripts.build).toBe('build')
		})
	})

	describe('missing required fields', () => {
		it('rejects missing project section', () => {
			const parsed = parseConfig({})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toEqual(['[project] section is required'])
		})

		it('rejects missing project.name', () => {
			const parsed = parseConfig({ project: { type: 'app' } })

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.name is required and must be a string',
			)
		})

		it('rejects missing project.type', () => {
			const parsed = parseConfig({ project: { name: 'my-app' } })

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining('project.type is required'),
				]),
			)
		})

		it('rejects invalid project.type', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'service' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining('project.type is required'),
				]),
			)
		})
	})

	describe('invalid values', () => {
		it('collects errors across all sections at once', () => {
			const parsed = parseConfig({
				project: {},
				scripts: { lint: 42 },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toHaveLength(3)
			expect(parsed.errors).toContain(
				'project.name is required and must be a string',
			)
			expect(parsed.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining('project.type is required'),
				]),
			)
			expect(parsed.errors).toContain(
				'scripts.lint must be a string or false, got number',
			)
		})

		it('rejects non-string non-false script values', () => {
			const parsed = parseConfig({
				project: { name: 'test', type: 'package' },
				scripts: { lint: 42 },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toEqual([
				'scripts.lint must be a string or false, got number',
			])
		})

		it('rejects empty string project.name', () => {
			const parsed = parseConfig({ project: { name: '', type: 'app' } })

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.name is required and must be a string',
			)
		})

		it.each([
			'x$(whoami)',
			'x;rm -rf /',
			'../evil',
			'a b',
			'UPPER',
			'snake_case',
			'-leading-dash',
			'trailing-dash-',
			'dot.in.name',
		])('rejects unsafe project.name: %s', name => {
			const parsed = parseConfig({ project: { name, type: 'app' } })

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.name must be lowercase alphanumeric with dashes only (pattern: ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$)',
			)
		})

		it.each([
			'a',
			'my-app',
			'my-app-2',
			'logger',
			'brand-assets',
			'api-v1',
		])('accepts safe project.name: %s', name => {
			const parsed = parseConfig({
				project: { name, type: 'package' },
			})

			expect(parsed.ok).toBe(true)
		})
	})

	describe('project.filter', () => {
		it('defaults filter to false when not provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.filter).toBe(false)
		})

		it('accepts a string filter', () => {
			const parsed = parseConfig({
				project: {
					name: 'logger',
					type: 'package',
					filter: '@nextnode-solutions/logger',
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.filter).toBe(
				'@nextnode-solutions/logger',
			)
		})

		it('accepts false to explicitly disable filter', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package', filter: false },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.filter).toBe(false)
		})

		it('rejects non-string non-false filter values', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', filter: 42 },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.filter must be a string or false',
			)
		})
	})

	describe('package section', () => {
		it('defaults package to false when not provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.package).toBe(false)
		})

		it('parses package section with access', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				package: { access: 'public' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.package).toEqual({ access: 'public' })
		})

		it('rejects package section without access', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				package: {},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'package.access is required and must be a string',
			)
		})

		it('rejects non-string access', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				package: { access: 42 },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'package.access is required and must be a string',
			)
		})
	})

	describe('environment', () => {
		it('defaults development to true when environment section not provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.environment.development).toBe(true)
		})

		it('accepts development set to true', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
				environment: { development: true },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.environment.development).toBe(true)
		})

		it('accepts development set to false', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
				environment: { development: false },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.environment.development).toBe(false)
		})

		it('rejects non-boolean development value', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app' },
				environment: { development: 'yes' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'environment.development must be a boolean',
			)
		})

		it('ignores unknown environment keys without error', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
				environment: { development: true, unknown_key: 'whatever' },
			})

			expect(parsed.ok).toBe(true)
		})
	})

	describe('project.domain', () => {
		it('defaults domain to undefined when not provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.domain).toBeUndefined()
		})

		it('accepts a non-empty string domain', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.domain).toBe('example.com')
		})

		it('rejects empty-string domain', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static', domain: '' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.domain must be a non-empty string',
			)
		})

		it('rejects non-string domain', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static', domain: 42 },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.domain must be a non-empty string',
			)
		})
	})

	describe('project.redirect_domains', () => {
		it('defaults redirect_domains to empty array when not provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.redirectDomains).toEqual([])
		})

		it('accepts an array of domain strings', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
					redirect_domains: ['example.fr', 'example.net'],
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.redirectDomains).toEqual([
				'example.fr',
				'example.net',
			])
		})

		it('rejects non-array redirect_domains', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					redirect_domains: 'example.fr',
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.redirect_domains must be an array of strings',
			)
		})

		it('rejects empty-string entries', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					redirect_domains: ['example.fr', ''],
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.redirect_domains entries must be non-empty strings',
			)
		})

		it('rejects non-string entries', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					redirect_domains: ['example.fr', 42],
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.redirect_domains entries must be non-empty strings',
			)
		})
	})

	describe('project.internal', () => {
		it('defaults internal to false when not provided', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.internal).toBe(false)
		})

		it('accepts internal set to true when vps is pinned', () => {
			const parsed = parseConfig({
				project: {
					name: 'monitor',
					type: 'app',
					domain: 'monitor.nextnode.fr',
					internal: true,
				},
				deploy: {
					vps: 'monitor-vps',
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.internal).toBe(true)
		})

		it('accepts internal set to false', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
					internal: false,
				},
				deploy: { services: { app: { source: 'build' } } },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.internal).toBe(false)
		})

		it('rejects non-boolean internal value', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
					internal: 'yes',
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.internal must be a boolean',
			)
		})

		it('rejects internal with cloudflare-pages target', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					internal: true,
				},
				deploy: { target: 'cloudflare-pages' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.internal is not supported with deploy target "cloudflare-pages"',
			)
		})

		it('rejects internal with inferred cloudflare-pages target', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					internal: true,
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.internal is not supported with deploy target "cloudflare-pages"',
			)
		})

		it('accepts internal with hetzner-vps target when vps is pinned', () => {
			const parsed = parseConfig({
				project: {
					name: 'monitor',
					type: 'app',
					domain: 'monitor.nextnode.fr',
					internal: true,
				},
				deploy: {
					target: 'hetzner-vps',
					vps: 'monitor-vps',
					hetzner: { server_type: 'cx23', location: 'nbg1' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.internal).toBe(true)
			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: 'monitor-vps',
				volumes: [],
				hetzner: { serverType: 'cx23', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('rejects internal hetzner-vps without a pinned vps', () => {
			const parsed = parseConfig({
				project: {
					name: 'monitor',
					type: 'app',
					domain: 'monitor.nextnode.fr',
					internal: true,
				},
				deploy: {
					target: 'hetzner-vps',
					hetzner: { server_type: 'cx23', location: 'nbg1' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.vps is required when project.internal = true (internal projects must pin to a dedicated VPS so they never share with public projects)',
			)
		})
	})

	describe('deploy section', () => {
		it('defaults to cloudflare-pages with empty secrets for static projects', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: undefined,
			})
		})

		it('accepts an array of secret names', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'static' },
				deploy: { secrets: ['RESEND_API_KEY', 'ANALYTICS_API_KEY'] },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: ['RESEND_API_KEY', 'ANALYTICS_API_KEY'],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: undefined,
			})
		})

		it('rejects non-array secrets', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: { secrets: 'RESEND_API_KEY' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain('deploy.secrets must be an array')
		})

		it('rejects empty-string entries', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: { secrets: ['RESEND_API_KEY', ''] },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.secrets entries must be a non-empty secret name or a { name, generate, length } table',
			)
		})

		it('parses a generated secret table in [deploy].secrets', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
				deploy: {
					secrets: [
						'RESEND_API_KEY',
						{ name: 'JWT_SECRET', generate: 'token', length: 43 },
					],
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) {
				expect.unreachable('expected a successful pages parse')
			}

			// the generated name joins the pull pool alongside the must-exist one…
			expect(parsed.config.deploy.secrets).toEqual([
				'RESEND_API_KEY',
				'JWT_SECRET',
			])
			// …and its generation spec is captured for provisioning
			expect(parsed.config.deploy.generatedSecrets).toEqual([
				{ name: 'JWT_SECRET', generate: 'token', length: 43 },
			])
		})

		it('rejects an unknown generator', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
				deploy: {
					secrets: [{ name: 'X', generate: 'rsa', length: 32 }],
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) expect.unreachable('expected validation to fail')

			expect(parsed.errors).toContain(
				'deploy.secrets entry "X" `generate` must be one of: token, password',
			)
		})

		it('rejects a generated secret with an out-of-range length', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
				deploy: {
					secrets: [{ name: 'X', generate: 'token', length: 4 }],
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) expect.unreachable('expected validation to fail')

			expect(parsed.errors).toContain(
				'deploy.secrets entry "X" `length` must be an integer between 16 and 256',
			)
		})

		it('rejects a generated entry missing a name', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
				deploy: { secrets: [{ generate: 'token', length: 32 }] },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) expect.unreachable('expected validation to fail')

			expect(parsed.errors).toContain(
				'deploy.secrets generated entry must declare a non-empty string `name`',
			)
		})

		it('rejects a secret name declared more than once', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'example.com',
				},
				deploy: {
					secrets: [
						'DUP',
						{ name: 'DUP', generate: 'token', length: 32 },
					],
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) expect.unreachable('expected validation to fail')

			expect(parsed.errors).toContain(
				'deploy.secrets declares "DUP" more than once',
			)
		})
	})

	describe('deploy.volumes', () => {
		it('defaults volumes to an empty array when not provided', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { services: { app: { source: 'build' } } },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return

			expect(parsed.config.deploy.volumes).toEqual([])
		})

		it('parses [deploy.volumes] aliases into a sorted volume list', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					volumes: { data: '/var/lib/app', cache: '/var/cache/app' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return

			expect(parsed.config.deploy.volumes).toEqual([
				{ name: 'data', mount: '/var/lib/app' },
				{ name: 'cache', mount: '/var/cache/app' },
			])
		})

		it('rejects a non-table volumes value', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { volumes: ['data'] },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'[deploy.volumes] must be a table mapping alias to mount path',
			)
		})

		it('rejects a non-string mount path (missing path)', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { volumes: { data: 42 } },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.volumes.data must be a non-empty absolute mount path',
			)
		})

		it('rejects an empty mount path', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { volumes: { data: '' } },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.volumes.data must be a non-empty absolute mount path',
			)
		})

		it('rejects a relative mount path', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { volumes: { data: 'var/lib/app' } },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.volumes.data must be an absolute path (got "var/lib/app")',
			)
		})

		it('rejects an invalid alias', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { volumes: { 'BAD ALIAS': '/var/lib/app' } },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining(
						'deploy.volumes alias "BAD ALIAS" must be lowercase alphanumeric',
					),
				]),
			)
		})

		it('flows volumes through the validated hetzner-vps deploy section', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					volumes: { data: '/var/lib/app' },
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [{ name: 'data', mount: '/var/lib/app' }],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})
	})

	describe('deploy.services', () => {
		it('parses [deploy.services.app] build source and defaults port to 3000', () => {
			const parsed = parseConfig(
				appConfig({ app: { source: 'build', url: 'example.com' } }),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services).toEqual({
				app: {
					port: 3000,
					url: 'example.com',
					secrets: [],
					needs: [],
					dependsOn: [],
					source: 'build',
				},
			})
		})

		it('honors an explicit port and omits the build target when unset', () => {
			const parsed = parseConfig(
				appConfig({ web: { source: 'build', port: 8080 } }),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services['web']).toEqual({
				port: 8080,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
			})
		})

		it('keeps an explicit build target stage when declared', () => {
			const parsed = parseConfig(
				appConfig({ app: { source: 'build', target: 'runtime' } }),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services['app']).toEqual({
				port: 3000,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
				target: 'runtime',
			})
		})

		it('parses build_args names on a build service', () => {
			const parsed = parseConfig(
				appConfig({
					app: {
						source: 'build',
						build_args: ['SITE_URL', 'ANALYTICS_ID'],
					},
				}),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services['app']).toEqual({
				port: 3000,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
				buildArgs: ['SITE_URL', 'ANALYTICS_ID'],
			})
		})

		it('omits buildArgs when build_args is empty or unset', () => {
			const parsed = parseConfig(
				appConfig({ app: { source: 'build', build_args: [] } }),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services['app']).not.toHaveProperty(
				'buildArgs',
			)
		})

		it('rejects build_args on an upstream source', () => {
			const parsed = parseConfig(
				appConfig({
					app: {
						source: 'upstream',
						ref: 'docker.io/acme/app:1.0',
						build_args: ['SITE_URL'],
					},
				}),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.app.build_args is only allowed when source = "build"',
			)
		})

		it('defaults a service with no source to build', () => {
			const parsed = parseConfig(
				appConfig({ app: { url: 'example.com' } }),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services['app']).toEqual({
				port: 3000,
				url: 'example.com',
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
			})
		})

		it('parses an upstream service with a ref', () => {
			const parsed = parseConfig(
				appConfig({
					app: {
						source: 'upstream',
						ref: 'docker.n8n.io/n8nio/n8n:1.85.0',
					},
				}),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'hetzner-vps') return

			expect(parsed.config.deploy.services['app']).toEqual({
				port: 3000,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'upstream',
				ref: 'docker.n8n.io/n8nio/n8n:1.85.0',
			})
		})

		it('requires at least one service for a hetzner-vps target', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'at least one [deploy.services.<name>] is required',
			)
		})

		it('rejects the legacy [deploy.image] field', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					image: { source: 'build' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.image is an unknown field - migrate to [deploy.services.<name>]',
			)
		})

		it('rejects ref alongside a build source', () => {
			const parsed = parseConfig(
				appConfig({ app: { source: 'build', ref: 'something' } }),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.app.ref is only allowed when source = "upstream"',
			)
		})

		it('rejects an upstream source without a ref', () => {
			const parsed = parseConfig(
				appConfig({ app: { source: 'upstream' } }),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.app.ref is required and must be a non-empty string when source = "upstream"',
			)
		})

		it('rejects build-only fields on an upstream source', () => {
			const parsed = parseConfig(
				appConfig({
					app: { source: 'upstream', ref: 'foo', target: 'bar' },
				}),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.app.target is only allowed when source = "build"',
			)
		})

		it('parses every declared service into the services Record', () => {
			const parsed = parseConfig(
				appConfig({
					front: { source: 'build', url: 'example.com' },
					api: { source: 'build', url: 'api.example.com' },
				}),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) {
				expect.unreachable('expected a successful hetzner-vps parse')
			}
			if (parsed.config.deploy.target !== 'hetzner-vps') {
				expect.unreachable('expected the hetzner-vps deploy target')
			}

			expect(parsed.config.deploy.services).toEqual({
				front: {
					port: 3000,
					url: 'example.com',
					secrets: [],
					needs: [],
					dependsOn: [],
					source: 'build',
				},
				api: {
					port: 3000,
					url: 'api.example.com',
					secrets: [],
					needs: [],
					dependsOn: [],
					source: 'build',
				},
			})
		})

		it('rejects two services sharing a url', () => {
			const parsed = parseConfig(
				appConfig({
					front: { source: 'build', url: 'example.com' },
					api: { source: 'build', url: 'example.com' },
				}),
			)

			if (parsed.ok) {
				expect.unreachable(
					'expected a duplicate-url validation failure',
				)
			}

			expect(parsed.errors).toContain(
				'deploy.services.api.url "example.com" duplicates deploy.services.front.url - each routed service needs a distinct url',
			)
		})

		it.each([
			{ url: 'foreign.com', label: 'an unrelated domain' },
			{
				url: 'notexample.com',
				label: 'a suffix look-alike with no dot boundary',
			},
		])(
			'rejects a service url ($label) outside project.domain',
			({ url }) => {
				const parsed = parseConfig(
					appConfig({ api: { source: 'build', url } }),
				)

				if (parsed.ok) {
					expect.unreachable(
						'expected a url-ownership validation failure',
					)
				}

				expect(parsed.errors).toContain(
					`deploy.services.api.url "${url}" must belong to project.domain "example.com" (equal to it or a sub-domain)`,
				)
			},
		)

		it('rejects services that mix build and upstream image sources', () => {
			const parsed = parseConfig(
				appConfig({
					front: { source: 'build', url: 'example.com' },
					api: {
						source: 'upstream',
						ref: 'docker.n8n.io/n8nio/n8n:1.85.0',
						url: 'api.example.com',
					},
				}),
			)

			if (parsed.ok) {
				expect.unreachable('expected a mixed-source validation failure')
			}

			expect(parsed.errors).toContain(
				'deploy.services mixes image sources (build: front; upstream: api) - a Hetzner deploy builds or pulls all services together; declare a single source across services',
			)
		})

		it('accepts multiple services that all share the upstream source', () => {
			const parsed = parseConfig(
				appConfig({
					n8n: {
						source: 'upstream',
						ref: 'docker.n8n.io/n8nio/n8n:1.85.0',
						url: 'example.com',
					},
					grafana: {
						source: 'upstream',
						ref: 'docker.io/grafana/grafana:11.0.0',
						url: 'metrics.example.com',
					},
				}),
			)

			expect(parsed.ok).toBe(true)
		})

		it('derives the deploy secret pool from the union of every service secret (no [deploy].secrets)', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: {
						front: {
							source: 'build',
							url: 'example.com',
							secrets: ['SESSION_KEY'],
						},
						api: {
							source: 'build',
							url: 'api.example.com',
							secrets: ['JWT_SECRET', 'SESSION_KEY'],
						},
					},
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) {
				expect.unreachable('expected a successful hetzner-vps parse')
			}
			if (parsed.config.deploy.target !== 'hetzner-vps') {
				expect.unreachable('expected the hetzner-vps deploy target')
			}

			// each service keeps its own declared secrets…
			expect(parsed.config.deploy.services['front']?.secrets).toEqual([
				'SESSION_KEY',
			])
			expect(parsed.config.deploy.services['api']?.secrets).toEqual([
				'JWT_SECRET',
				'SESSION_KEY',
			])
			// …and the pool is the deduped union, in first-seen order
			expect(parsed.config.deploy.secrets).toEqual([
				'SESSION_KEY',
				'JWT_SECRET',
			])
		})

		it('injects a global [deploy].secrets entry into every service on a hetzner-vps target', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					secrets: ['PREVIEW_SECRET'],
					services: {
						app: {
							source: 'build',
							url: 'example.com',
							secrets: ['RESEND_API_KEY'],
						},
						worker: { source: 'build' },
					},
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) {
				expect.unreachable('expected a successful hetzner-vps parse')
			}
			if (parsed.config.deploy.target !== 'hetzner-vps') {
				expect.unreachable('expected the hetzner-vps deploy target')
			}

			// the global secret reaches every service (global ∪ own, deduped)…
			expect(parsed.config.deploy.services['app']?.secrets).toEqual([
				'PREVIEW_SECRET',
				'RESEND_API_KEY',
			])
			expect(parsed.config.deploy.services['worker']?.secrets).toEqual([
				'PREVIEW_SECRET',
			])
			// …and the pull pool is the union of global + every service's own
			expect(parsed.config.deploy.secrets).toEqual([
				'PREVIEW_SECRET',
				'RESEND_API_KEY',
			])
		})

		it('rejects a needs referencing a backing service that is not declared', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: {
						app: {
							source: 'build',
							url: 'example.com',
							needs: ['postgres'],
						},
					},
				},
			})

			if (parsed.ok) {
				expect.unreachable('expected an undeclared-needs failure')
			}

			expect(parsed.errors).toContain(
				'deploy.services.app.needs references "postgres" but no [services.postgres] is declared',
			)
		})

		it('accepts a needs referencing a declared backing service', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				services: { postgres: { mode: 'embedded' } },
				deploy: {
					services: {
						app: {
							source: 'build',
							url: 'example.com',
							needs: ['postgres'],
						},
					},
				},
			})

			expect(parsed.ok).toBe(true)
		})

		it('accepts a depends_on referencing a declared sibling service', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: {
						front: {
							source: 'build',
							url: 'example.com',
							depends_on: ['api'],
						},
						api: { source: 'build', url: 'api.example.com' },
					},
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) {
				expect.unreachable('expected a successful hetzner-vps parse')
			}
			if (parsed.config.deploy.target !== 'hetzner-vps') {
				expect.unreachable('expected the hetzner-vps deploy target')
			}

			expect(parsed.config.deploy.services['front']?.dependsOn).toEqual([
				'api',
			])
		})

		it('rejects a depends_on referencing an undeclared service', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: {
						front: {
							source: 'build',
							url: 'example.com',
							depends_on: ['nonexistent'],
						},
					},
				},
			})

			if (parsed.ok) {
				expect.unreachable(
					'expected an unknown-service depends_on validation failure',
				)
			}

			expect(parsed.errors).toContain(
				'deploy.services.front.depends_on references unknown service "nonexistent" - declare it in [deploy.services]',
			)
		})

		it('rejects a non-kebab service name', () => {
			const parsed = parseConfig(
				appConfig({ App_1: { source: 'build' } }),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toEqual(
				expect.arrayContaining([
					expect.stringContaining(
						'deploy.services name "App_1" must be lowercase alphanumeric',
					),
				]),
			)
		})

		it('reports distinct errors for a non-array list vs an empty entry', () => {
			const notArray = parseConfig(
				appConfig({ app: { source: 'build', secrets: 'SESSION_KEY' } }),
			)
			expect(notArray.ok).toBe(false)
			if (!notArray.ok) {
				expect(notArray.errors).toContain(
					'deploy.services.app.secrets must be an array of strings',
				)
			}

			const emptyEntry = parseConfig(
				appConfig({ app: { source: 'build', needs: [''] } }),
			)
			expect(emptyEntry.ok).toBe(false)
			if (!emptyEntry.ok) {
				expect(emptyEntry.errors).toContain(
					'deploy.services.app.needs entries must be non-empty strings',
				)
			}
		})

		it('rejects [deploy.services] for cloudflare-pages targets', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'my-site.example.com',
				},
				deploy: {
					target: 'cloudflare-pages',
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'[deploy.services] is not supported with deploy target "cloudflare-pages"',
			)
		})
	})

	describe('deploy target cloudflare-workers services', () => {
		it.each([
			[
				'port',
				8080,
				'deploy.services.web.port is not supported with deploy target "cloudflare-workers" (a Worker is not a container: it has no listening port - drop `port`)',
			],
			[
				'source',
				'build',
				'deploy.services.web.source is not supported with deploy target "cloudflare-workers" (a Worker is not a container: it is not built or pulled as an image - drop `source`)',
			],
			[
				'ref',
				'docker.io/acme/app:1.0',
				'deploy.services.web.ref is not supported with deploy target "cloudflare-workers" (a Worker is not a container: there is no image to pull - drop `ref`)',
			],
			[
				'registry_auth_secret',
				'REGISTRY_TOKEN',
				'deploy.services.web.registry_auth_secret is not supported with deploy target "cloudflare-workers" (a Worker is not a container: there is no registry to authenticate against - drop `registry_auth_secret`)',
			],
			[
				'context',
				'.',
				'deploy.services.web.context is not supported with deploy target "cloudflare-workers" (a Worker is not a container: it has no Docker build context - drop `context`)',
			],
			[
				'dockerfile',
				'Dockerfile',
				'deploy.services.web.dockerfile is not supported with deploy target "cloudflare-workers" (a Worker is not a container: it has no Dockerfile - drop `dockerfile`)',
			],
			[
				'target',
				'runtime',
				'deploy.services.web.target is not supported with deploy target "cloudflare-workers" (a Worker is not a container: it has no Docker build stage - drop `target`)',
			],
			[
				'build_args',
				['SITE_URL'],
				'deploy.services.web.build_args is not supported with deploy target "cloudflare-workers" (a Worker is not a container: it has no Docker build - point `entry` at the bundle and drop `build_args`)',
			],
		])(
			'rejects the container-only field %s',
			(field, fieldValue, message) => {
				const parsed = parseConfig(
					workersConfig({
						web: { url: 'example.com', [field]: fieldValue },
					}),
				)

				expect(parsed.ok).toBe(false)
				if (parsed.ok) return

				expect(parsed.errors).toContain(message)
			},
		)

		it('defaults entry to the Astro worker bundle path', () => {
			const parsed = parseConfig(
				workersConfig({ web: { url: 'example.com' } }),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'cloudflare-workers') return

			expect(parsed.config.deploy.services['web']?.entry).toBe(
				'dist/_worker.js/index.js',
			)
		})

		it('honors an explicit entry override', () => {
			const parsed = parseConfig(
				workersConfig({
					web: { url: 'example.com', entry: 'dist/server/index.js' },
				}),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'cloudflare-workers') return

			expect(parsed.config.deploy.services['web']).toEqual({
				url: 'example.com',
				secrets: [],
				needs: [],
				dependsOn: [],
				entry: 'dist/server/index.js',
			})
		})

		it('accepts an internal worker with no url', () => {
			const parsed = parseConfig(workersConfig({ api: {} }))

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'cloudflare-workers') return

			expect(parsed.config.deploy.services['api']).toEqual({
				secrets: [],
				needs: [],
				dependsOn: [],
				entry: 'dist/_worker.js/index.js',
			})
		})

		it('rejects a routed url outside project.domain', () => {
			const parsed = parseConfig(
				workersConfig({ web: { url: 'other.com' } }),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.web.url "other.com" must belong to project.domain "example.com" (equal to it or a sub-domain)',
			)
		})

		it('rejects two workers sharing the same url', () => {
			const parsed = parseConfig(
				workersConfig({
					web: { url: 'example.com' },
					api: { url: 'example.com' },
				}),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.api.url "example.com" duplicates deploy.services.web.url - each routed worker needs a distinct url',
			)
		})

		it('rejects a needs referencing an undeclared backing service', () => {
			const parsed = parseConfig(
				workersConfig({ web: { url: 'example.com', needs: ['d1'] } }),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.web.needs references "d1" but no [services.d1] is declared',
			)
		})

		it('rejects a depends_on referencing an unknown worker', () => {
			const parsed = parseConfig(
				workersConfig({
					web: { url: 'example.com', depends_on: ['ghost'] },
				}),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.services.web.depends_on references unknown service "ghost" - declare it in [deploy.services]',
			)
		})

		it('folds the global secret pool into every worker service', () => {
			const parsed = parseConfig(
				workersConfig(
					{
						web: { url: 'example.com', secrets: ['WEB_KEY'] },
						api: {},
					},
					{ secrets: ['GLOBAL_TOKEN'] },
				),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) {
				expect.unreachable(
					'expected a successful cloudflare-workers parse',
				)
			}
			if (parsed.config.deploy.target !== 'cloudflare-workers') {
				expect.unreachable(
					'expected the cloudflare-workers deploy target',
				)
			}

			expect(parsed.config.deploy.services['web']?.secrets).toEqual([
				'GLOBAL_TOKEN',
				'WEB_KEY',
			])
			expect(parsed.config.deploy.services['api']?.secrets).toEqual([
				'GLOBAL_TOKEN',
			])
			expect(parsed.config.deploy.secrets).toEqual([
				'GLOBAL_TOKEN',
				'WEB_KEY',
			])
		})

		it('accepts a valid [[deploy.cron]] job as a Workers cron trigger', () => {
			const parsed = parseConfig(
				workersConfig(
					{ web: { url: 'example.com' } },
					{
						cron: [
							{
								name: 'nightly',
								schedule: '0 3 * * *',
								path: '/api/cron',
								service: 'web',
							},
						],
					},
				),
			)

			expect(parsed.ok).toBe(true)
			if (!parsed.ok || parsed.config.deploy === false) return
			if (parsed.config.deploy.target !== 'cloudflare-workers') return

			expect(parsed.config.deploy.cron).toEqual([
				{
					name: 'nightly',
					schedule: '0 3 * * *',
					path: '/api/cron',
					method: 'POST',
					service: 'web',
				},
			])
		})

		it('rejects a cron job targeting an undeclared worker', () => {
			const parsed = parseConfig(
				workersConfig(
					{ web: { url: 'example.com' } },
					{
						cron: [
							{
								name: 'nightly',
								schedule: '0 3 * * *',
								path: '/api/cron',
								service: 'ghost',
							},
						],
					},
				),
			)

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.cron job "nightly" service "ghost" must reference a declared [deploy.services.<name>]',
			)
		})
	})

	describe('deploy target', () => {
		it('infers hetzner-vps for app type with valid hetzner config', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('infers cloudflare-pages for static type', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: undefined,
			})
		})

		it('accepts explicit target override for app', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app' },
				deploy: { target: 'cloudflare-pages' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'cloudflare-pages',
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: undefined,
			})
		})

		it('accepts explicit hetzner-vps target for static with hetzner config', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'my-site.example.com',
				},
				deploy: {
					target: 'hetzner-vps',
					hetzner: { server_type: 'cax11', location: 'fsn1' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cax11', location: 'fsn1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('defaults hetzner config when the deploy section declares only services', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { services: { app: { source: 'build' } } },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cx23', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('defaults hetzner config when deploy section omits it', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					target: 'hetzner-vps',
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cx23', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('defaults individual hetzner fields when partially specified', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: 'cpx22' },
					services: { app: { source: 'build' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: [],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})

		it('rejects hetzner-vps without project.domain', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app' },
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'project.domain is required when deploy target is "hetzner-vps"',
			)
		})

		it('rejects invalid hetzner field values', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: '', location: 42 },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.hetzner.server_type must be a non-empty string',
			)
			expect(parsed.errors).toContain(
				'deploy.hetzner.location must be a non-empty string',
			)
		})

		it('rejects non-table hetzner section', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { hetzner: 'invalid' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain('[deploy.hetzner] must be a table')
		})

		it('rejects invalid deploy target string', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: { target: 'aws-ecs' },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'deploy.target must be one of: hetzner-vps, cloudflare-pages, cloudflare-workers',
			)
		})

		it('rejects [deploy] section for package type', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				deploy: { secrets: ['DB_URL'] },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'[deploy] section is forbidden for project type "package"',
			)
		})

		it('sets deploy to false for package type without deploy section', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toBe(false)
		})

		it('rejects non-table deploy section', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
				deploy: 'invalid',
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain('[deploy] must be a table')
		})

		it('derives the hetzner-vps secret pool as the union of service secrets', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: {
					hetzner: { server_type: 'cpx22', location: 'nbg1' },
					services: {
						app: {
							source: 'build',
							secrets: ['DATABASE_URL', 'REDIS_URL'],
						},
					},
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.deploy).toEqual({
				target: 'hetzner-vps',
				cron: [],
				secrets: ['DATABASE_URL', 'REDIS_URL'],
				generatedSecrets: [],
				vps: null,
				volumes: [],
				hetzner: { serverType: 'cpx22', location: 'nbg1' },
				services: {
					app: {
						port: 3000,
						secrets: ['DATABASE_URL', 'REDIS_URL'],
						needs: [],
						dependsOn: [],
						source: 'build',
					},
				},
			})
		})
	})

	describe('static project type', () => {
		it('parses a valid static config', () => {
			const parsed = parseConfig({
				project: { name: 'my-site', type: 'static' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.project.type).toBe('static')
		})
	})

	describe('services section', () => {
		it('defaults services to an empty object when not provided', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { services: { app: { source: 'build' } } },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.services).toEqual({})
		})

		it('parses [services.r2] buckets into the config', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				deploy: { services: { app: { source: 'build' } } },
				services: {
					r2: {
						buckets: [
							{ name: 'uploads', cdn: true },
							{ name: 'media' },
						],
					},
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.services).toEqual({
				r2: {
					buckets: [
						{ name: 'uploads', cdn: true },
						{ name: 'media', cdn: false },
					],
				},
			})
		})

		it('rejects [services] for package projects', () => {
			const parsed = parseConfig({
				project: { name: 'my-lib', type: 'package' },
				services: {
					r2: { buckets: [{ name: 'uploads', cdn: false }] },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'[services] section is forbidden for project type "package" - only "app" projects have a runtime that can consume service env vars',
			)
		})

		it('rejects [services] for static projects', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-site',
					type: 'static',
					domain: 'my-site.example.com',
				},
				services: {
					r2: { buckets: [{ name: 'uploads', cdn: false }] },
				},
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'[services] section is forbidden for project type "static" - only "app" projects have a runtime that can consume service env vars',
			)
		})

		it('rejects an empty bucket list', () => {
			const parsed = parseConfig({
				project: {
					name: 'my-app',
					type: 'app',
					domain: 'my-app.example.com',
				},
				services: { r2: { buckets: [] } },
			})

			expect(parsed.ok).toBe(false)
			if (parsed.ok) return

			expect(parsed.errors).toContain(
				'services.r2.buckets must declare at least one bucket',
			)
		})
	})

	describe('edge cases', () => {
		it('ignores unknown script keys without error', () => {
			const parsed = parseConfig({
				project: { name: 'test', type: 'package' },
				scripts: { lint: 'lint', unknown_key: 'whatever' },
			})

			expect(parsed.ok).toBe(true)
		})

		it('handles undefined scripts section by using defaults', () => {
			const parsed = parseConfig({
				project: { name: 'test', type: 'package' },
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) return

			expect(parsed.config.scripts).toEqual({
				lint: 'lint',
				test: 'test',
				build: 'build',
			})
		})
	})

	describe('cron', () => {
		it('parses [[deploy.cron]] into the hetzner deploy section', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: { web: { source: 'build', url: 'example.com' } },
					cron: [
						{
							name: 'cleanup',
							schedule: '0 3 * * *',
							path: '/api/cron/cleanup',
						},
					],
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
			const { deploy } = parsed.config
			if (deploy === false || deploy.target !== 'hetzner-vps') {
				throw new Error('expected a hetzner-vps deploy section')
			}

			expect(deploy.cron).toEqual([
				{
					name: 'cleanup',
					schedule: '0 3 * * *',
					path: '/api/cron/cleanup',
					method: 'POST',
				},
			])
		})

		it('defaults cron to an empty array when no job is declared', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: { web: { source: 'build', url: 'example.com' } },
				},
			})

			expect(parsed.ok).toBe(true)
			if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
			const { deploy } = parsed.config
			if (deploy === false || deploy.target !== 'hetzner-vps') {
				throw new Error('expected a hetzner-vps deploy section')
			}

			expect(deploy.cron).toEqual([])
		})

		it('rejects a cron job targeting an undeclared service', () => {
			const parsed = parseConfig({
				project: { name: 'my-app', type: 'app', domain: 'example.com' },
				deploy: {
					services: { web: { source: 'build', url: 'example.com' } },
					cron: [
						{
							name: 'cleanup',
							schedule: '0 3 * * *',
							path: '/x',
							service: 'ghost',
						},
					],
				},
			})

			expect(parsed.ok).toBe(false)
			expect(parsed.ok ? [] : parsed.errors).toContain(
				'deploy.cron job "cleanup" service "ghost" must reference a declared [deploy.services.<name>]',
			)
		})

		it('rejects [[deploy.cron]] on a cloudflare-pages target', () => {
			const parsed = parseConfig({
				project: {
					name: 'site',
					type: 'static',
					domain: 'example.com',
				},
				deploy: {
					cron: [
						{ name: 'cleanup', schedule: '0 3 * * *', path: '/x' },
					],
				},
			})

			expect(parsed.ok).toBe(false)
			expect(parsed.ok ? [] : parsed.errors).toContain(
				'[[deploy.cron]] is not supported with deploy target "cloudflare-pages" (a static site has no always-on runtime to schedule against)',
			)
		})
	})
})
