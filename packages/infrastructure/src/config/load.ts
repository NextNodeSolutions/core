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

// Validate the [deploy] section for a deployable project and fold it into the
// final config, enforcing the project.internal/target compatibility rule.
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
		project.domain,
		declaredServices,
	)
	if (!deployResult.ok) return { ok: false, errors: deployResult.errors }

	const services = withImpliedServices(base.services, deployResult.section)

	const compatibilityErrors = [
		...checkServicesTargetCompatibility(services, deployResult.section),
		...checkInternalCompatibility(project, deployResult.section),
	]
	if (compatibilityErrors.length > 0) {
		return { ok: false, errors: compatibilityErrors }
	}

	return {
		ok: true,
		config: { ...base, services, deploy: deployResult.section },
	}
}

// A service flagged SERVICE_IMPLIABLE_FROM_NEEDS has no required config, so a
// bare `needs = ["<name>"]` provisions it without a `[services.<name>]` table.
// Synthesise the empty config here so every downstream consumer keeps the
// invariant "provisioned iff `services.<name>` is present" and needs no special
// case. An explicit table (overrides) already sets the key, so it is skipped.
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

// A backing service only validates against the deploy targets that can realise
// it (SERVICE_SUPPORTED_TARGETS): D1/KV/Queues are Cloudflare-Workers-only,
// postgres/observability are VPS-only, R2 spans both. Declaring one under a
// target that cannot provision it fails loud rather than silently ignoring it.
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

// A non-deployable project (package/lib) must not carry a [deploy] section;
// its config pins `deploy: false`.
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

function checkInternalCompatibility(
	project: ProjectSection,
	deploy: DeploySection,
): string[] {
	if (!project.internal) return []
	if (deploy.target === 'cloudflare-pages') {
		return [
			'project.internal is not supported with deploy target "cloudflare-pages"',
		]
	}
	if (deploy.target === 'cloudflare-workers') {
		return [
			'project.internal is not supported with deploy target "cloudflare-workers" (a Worker runs on Cloudflare\'s edge with no tailnet to join - pin an internal project to a dedicated VPS with deploy target "hetzner-vps")',
		]
	}
	if (deploy.vps === null) {
		return [
			'deploy.vps is required when project.internal = true (internal projects must pin to a dedicated VPS so they never share with public projects)',
		]
	}
	return []
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
