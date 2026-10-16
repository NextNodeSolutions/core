import { readFileSync } from 'node:fs'

import { parse as parseTOML } from 'smol-toml'

import {
	SERVICE_NAMES,
	SERVICE_SUPPORTED_TARGETS,
	impliableServiceNames,
} from './service-config.ts'
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

import type { ServicesConfig } from './service-config.ts'
import type {
	DeployableProjectType,
	DeploySection,
	NextNodeConfig,
	ParseConfigResult,
	ProjectSection,
} from './types.ts'

export function parseConfig(raw: Record<string, unknown>): ParseConfigResult {
	const projectResult = validateProjectSection(raw['project'])
	const scriptsResult = validateScriptsSection(raw['scripts'])
	const envResult = validateEnvironmentSection(raw['environment'])
	const pkgResult = validatePackageSection(raw['package'])
	const servicesResult = validateServicesSection(raw['services'])

	const sectionErrors = [
		projectResult,
		scriptsResult,
		envResult,
		pkgResult,
		servicesResult,
	].flatMap(r => (r.ok ? [] : r.errors))
	if (
		!projectResult.ok ||
		!scriptsResult.ok ||
		!envResult.ok ||
		!pkgResult.ok ||
		!servicesResult.ok
	) {
		return { ok: false, errors: sectionErrors }
	}

	const { type } = projectResult.section

	if (type !== 'app' && hasAnyService(servicesResult.section)) {
		return {
			ok: false,
			errors: [
				`[services] section is forbidden for project type "${type}" - only "app" projects have a runtime that can consume service env vars`,
			],
		}
	}

	const base = {
		project: projectResult.section,
		scripts: scriptsResult.section,
		environment: envResult.section,
		package: pkgResult.section,
		services: servicesResult.section,
	}

	if (!isDeployable(type)) {
		return parseNonDeployable(raw, type, base)
	}
	return assembleDeployable({
		raw,
		type,
		project: projectResult.section,
		base,
		declaredServices: new Set(Object.keys(servicesResult.section)),
	})
}

interface AssembleDeployableInput {
	readonly raw: Record<string, unknown>
	readonly type: DeployableProjectType
	readonly project: ProjectSection
	readonly base: Omit<NextNodeConfig, 'deploy'>
	readonly declaredServices: ReadonlySet<string>
}
function assembleDeployable({
	raw,
	type,
	project,
	base,
	declaredServices,
}: AssembleDeployableInput): ParseConfigResult {
	const deployResult = validateDeploySection(
		raw['deploy'],
		type,
		project,
		declaredServices,
	)
	if (!deployResult.ok) return { ok: false, errors: deployResult.errors }

	const services = withImpliedServices(base.services, deployResult.section)

	const compatibilityErrors = [
		...checkServicesTargetCompatibility(services, deployResult.section),
	]
	if (compatibilityErrors.length > 0) {
		return { ok: false, errors: compatibilityErrors }
	}

	return {
		ok: true,
		config: { ...base, services, deploy: deployResult.section },
	}
}
function withImpliedServices(
	services: ServicesConfig,
	deploy: DeploySection,
): ServicesConfig {
	if (!('services' in deploy)) return services
	const { services: workloads } = deploy
	const implied = impliableServiceNames(deploy.target).filter(
		name =>
			!services[name] &&
			Object.values(workloads).some(workload =>
				workload.needs.includes(name),
			),
	)
	if (!implied.length) return services
	return {
		...services,
		...Object.fromEntries(implied.map(name => [name, {}])),
	}
}
function checkServicesTargetCompatibility(
	services: ServicesConfig,
	deploy: DeploySection,
): string[] {
	return SERVICE_NAMES.filter(
		name =>
			services[name] &&
			!SERVICE_SUPPORTED_TARGETS[name].includes(deploy.target),
	).map(
		name =>
			`[services.${name}] is not supported with deploy target "${deploy.target}" (supported: ${SERVICE_SUPPORTED_TARGETS[name].join(', ')})`,
	)
}
function parseNonDeployable(
	raw: Record<string, unknown>,
	type: string,
	base: Omit<NextNodeConfig, 'deploy'>,
): ParseConfigResult {
	if (typeof raw['deploy'] !== 'undefined') {
		return {
			ok: false,
			errors: [
				`[deploy] section is forbidden for project type "${type}"`,
			],
		}
	}
	return { ok: true, config: { ...base, deploy: false } }
}

export function loadConfig(configPath: string): NextNodeConfig {
	const content = readFileSync(configPath, 'utf-8')
	const raw = parseTOML(content)
	const parsed = parseConfig(raw)

	if (!parsed.ok) {
		throw new Error(
			`Invalid nextnode.toml:\n${parsed.errors.map(e => `  - ${e}`).join('\n')}`,
		)
	}

	return parsed.config
}
