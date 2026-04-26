import { readFileSync } from 'node:fs'

import { parse as parseTOML } from 'smol-toml'

import type { NextNodeConfig, ParseConfigResult } from './types.ts'
import { isDeployable } from './types.ts'
import { validateDeploySection } from './validation/deploy.ts'
import {
	validateEnvironmentSection,
	validateScriptsSection,
} from './validation/pipeline.ts'
import {
	validatePackageSection,
	validateProjectSection,
} from './validation/project.ts'
import {
	hasAnyService,
	validateServicesSection,
} from './validation/services.ts'

export function parseConfig(raw: Record<string, unknown>): ParseConfigResult {
	const projectResult = validateProjectSection(raw['project'])
	const scriptsResult = validateScriptsSection(raw['scripts'])
	const envResult = validateEnvironmentSection(raw['environment'])
	const pkgResult = validatePackageSection(raw['package'])
	const servicesResult = validateServicesSection(raw['services'])

	if (
		!projectResult.ok ||
		!scriptsResult.ok ||
		!envResult.ok ||
		!pkgResult.ok ||
		!servicesResult.ok
	) {
		return {
			ok: false,
			errors: [
				projectResult,
				scriptsResult,
				envResult,
				pkgResult,
				servicesResult,
			].flatMap(r => (r.ok ? [] : r.errors)),
		}
	}

	const { type } = projectResult.section

	if (type !== 'app' && hasAnyService(servicesResult.section)) {
		return {
			ok: false,
			errors: [
				`[services] section is forbidden for project type "${type}" — only "app" projects have a runtime that can consume service env vars`,
			],
		}
	}

	if (!isDeployable(type)) {
		if (raw['deploy'] !== undefined) {
			return {
				ok: false,
				errors: [
					`[deploy] section is forbidden for project type "${type}"`,
				],
			}
		}

		return {
			ok: true,
			config: {
				project: projectResult.section,
				scripts: scriptsResult.section,
				environment: envResult.section,
				package: pkgResult.section,
				deploy: false,
				services: servicesResult.section,
			},
		}
	}

	const hasDomain = projectResult.section.domain !== undefined
	const deployResult = validateDeploySection(raw['deploy'], type, hasDomain)
	if (!deployResult.ok) return { ok: false, errors: deployResult.errors }

	if (
		projectResult.section.internal &&
		deployResult.section.target === 'cloudflare-pages'
	) {
		return {
			ok: false,
			errors: [
				'project.internal is not supported with deploy target "cloudflare-pages"',
			],
		}
	}

	return {
		ok: true,
		config: {
			project: projectResult.section,
			scripts: scriptsResult.section,
			environment: envResult.section,
			package: pkgResult.section,
			deploy: deployResult.section,
			services: servicesResult.section,
		},
	}
}

export function loadConfig(configPath: string): NextNodeConfig {
	const content = readFileSync(configPath, 'utf-8')
	const raw = parseTOML(content)
	const result = parseConfig(raw)

	if (!result.ok) {
		throw new Error(
			`Invalid nextnode.toml:\n${result.errors.map(e => `  - ${e}`).join('\n')}`,
		)
	}

	return result.config
}
