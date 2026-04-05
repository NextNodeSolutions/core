export interface NextNodeConfig {
	readonly project: ProjectSection
	readonly scripts: ScriptsSection
	readonly package: PackageSection | false
	readonly environment: EnvironmentSection
}

const PROJECT_TYPES = ['app', 'package', 'static'] as const
type ProjectType = (typeof PROJECT_TYPES)[number]

export interface ProjectSection {
	readonly name: string
	readonly type: ProjectType
	readonly filter: string | false
	readonly domain: string | undefined
	readonly redirectDomains: ReadonlyArray<string>
}

export interface ScriptsSection {
	readonly lint: string | false
	readonly test: string | false
	readonly build: string | false
}

export interface PackageSection {
	readonly access: string
}

export interface EnvironmentSection {
	readonly development: boolean
}

export const DEFAULT_SCRIPTS: ScriptsSection = {
	lint: 'lint',
	test: 'test',
	build: 'build',
}

export const DEFAULT_ENVIRONMENT: EnvironmentSection = {
	development: true,
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

function isProjectType(value: unknown): value is ProjectType {
	return (
		typeof value === 'string' &&
		PROJECT_TYPES.includes(value as ProjectType)
	)
}

function isScriptValue(value: unknown): value is string | false {
	return typeof value === 'string' || value === false
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveScript(
	value: unknown,
	fallback: string | false,
): string | false {
	if (isScriptValue(value)) return value
	return fallback
}

export function parseConfig(raw: Record<string, unknown>): ParseConfigResult {
	const errors: string[] = []

	const project = raw['project']
	if (!isRecord(project)) {
		return { ok: false, errors: ['[project] section is required'] }
	}

	const name = project['name']
	if (!name || typeof name !== 'string') {
		errors.push('project.name is required and must be a string')
	}

	const type = project['type']
	if (!type || !isProjectType(type)) {
		errors.push(
			`project.type is required and must be one of: ${PROJECT_TYPES.join(', ')}`,
		)
	}

	const filter = project['filter']
	if (filter !== undefined && !isScriptValue(filter)) {
		errors.push('project.filter must be a string or false')
	}

	const domain = project['domain']
	if (domain !== undefined && (typeof domain !== 'string' || domain === '')) {
		errors.push('project.domain must be a non-empty string')
	}

	const redirectDomains = project['redirect_domains']
	if (redirectDomains !== undefined) {
		if (!Array.isArray(redirectDomains)) {
			errors.push('project.redirect_domains must be an array of strings')
		} else {
			for (const entry of redirectDomains) {
				if (typeof entry !== 'string' || entry === '') {
					errors.push(
						'project.redirect_domains entries must be non-empty strings',
					)
					break
				}
			}
		}
	}

	const scripts = raw['scripts']
	if (scripts !== undefined && !isRecord(scripts)) {
		errors.push('[scripts] must be a table')
	}

	if (isRecord(scripts)) {
		for (const key of ['lint', 'test', 'build'] as const) {
			const value = scripts[key]
			if (value !== undefined && !isScriptValue(value)) {
				errors.push(
					`scripts.${key} must be a string or false, got ${typeof value}`,
				)
			}
		}
	}

	const environment = raw['environment']
	if (environment !== undefined && !isRecord(environment)) {
		errors.push('[environment] must be a table')
	}

	const development = isRecord(environment)
		? environment['development']
		: undefined
	if (development !== undefined && !isBoolean(development)) {
		errors.push('environment.development must be a boolean')
	}

	if (errors.length > 0 || typeof name !== 'string' || !isProjectType(type)) {
		return { ok: false, errors }
	}

	const scriptValues = isRecord(scripts) ? scripts : {}
	const pkg = raw['package']

	let packageSection: PackageSection | false = false
	if (isRecord(pkg)) {
		const access = pkg['access']
		if (!access || typeof access !== 'string') {
			errors.push('package.access is required and must be a string')
		} else {
			packageSection = { access }
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors }
	}

	const resolvedDomain = typeof domain === 'string' ? domain : undefined
	const resolvedRedirectDomains: ReadonlyArray<string> = Array.isArray(
		redirectDomains,
	)
		? redirectDomains.filter(
				(entry): entry is string => typeof entry === 'string',
			)
		: []

	return {
		ok: true,
		config: {
			project: {
				name,
				type,
				filter: isScriptValue(filter) ? filter : false,
				domain: resolvedDomain,
				redirectDomains: resolvedRedirectDomains,
			},
			scripts: {
				lint: resolveScript(scriptValues['lint'], DEFAULT_SCRIPTS.lint),
				test: resolveScript(scriptValues['test'], DEFAULT_SCRIPTS.test),
				build: resolveScript(
					scriptValues['build'],
					DEFAULT_SCRIPTS.build,
				),
			},
			package: packageSection,
			environment: {
				development: isBoolean(development)
					? development
					: DEFAULT_ENVIRONMENT.development,
			},
		},
	}
}

type ParseConfigResult =
	| { readonly ok: true; readonly config: NextNodeConfig }
	| { readonly ok: false; readonly errors: readonly string[] }
