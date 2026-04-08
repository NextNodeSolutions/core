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

const PROJECT_TYPE_SET: ReadonlySet<string> = new Set(PROJECT_TYPES)

function isProjectType(value: unknown): value is ProjectType {
	return typeof value === 'string' && PROJECT_TYPE_SET.has(value)
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

function validateProjectSection(project: Record<string, unknown>): {
	errors: string[]
	name: unknown
	type: unknown
} {
	const errors: string[] = []
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
	if (project['filter'] !== undefined && !isScriptValue(project['filter'])) {
		errors.push('project.filter must be a string or false')
	}
	if (
		project['domain'] !== undefined &&
		(typeof project['domain'] !== 'string' || project['domain'] === '')
	) {
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
	return { errors, name, type }
}

function validateScriptsSection(raw: Record<string, unknown>): {
	errors: string[]
	scriptValues: Record<string, unknown>
} {
	const scripts = raw['scripts']
	const errors: string[] = []
	if (scripts !== undefined && !isRecord(scripts)) {
		errors.push('[scripts] must be a table')
		return { errors, scriptValues: {} }
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
	return { errors, scriptValues: isRecord(scripts) ? scripts : {} }
}

function validateEnvironmentSection(raw: Record<string, unknown>): {
	errors: string[]
	development: unknown
} {
	const environment = raw['environment']
	const errors: string[] = []
	if (environment !== undefined && !isRecord(environment)) {
		errors.push('[environment] must be a table')
		return { errors, development: undefined }
	}
	const development = isRecord(environment)
		? environment['development']
		: undefined
	if (development !== undefined && !isBoolean(development)) {
		errors.push('environment.development must be a boolean')
	}
	return { errors, development }
}

function validatePackageSection(raw: Record<string, unknown>): {
	errors: string[]
	packageSection: PackageSection | false
} {
	const pkg = raw['package']
	if (!isRecord(pkg)) return { errors: [], packageSection: false }
	const access = pkg['access']
	if (!access || typeof access !== 'string') {
		return {
			errors: ['package.access is required and must be a string'],
			packageSection: false,
		}
	}
	return { errors: [], packageSection: { access } }
}

export function parseConfig(raw: Record<string, unknown>): ParseConfigResult {
	const project = raw['project']
	if (!isRecord(project)) {
		return { ok: false, errors: ['[project] section is required'] }
	}

	const projectResult = validateProjectSection(project)
	const scriptsResult = validateScriptsSection(raw)
	const envResult = validateEnvironmentSection(raw)

	const earlyErrors = [
		...projectResult.errors,
		...scriptsResult.errors,
		...envResult.errors,
	]
	if (
		earlyErrors.length > 0 ||
		typeof projectResult.name !== 'string' ||
		!isProjectType(projectResult.type)
	) {
		return { ok: false, errors: earlyErrors }
	}

	const pkgResult = validatePackageSection(raw)
	if (pkgResult.errors.length > 0) {
		return { ok: false, errors: pkgResult.errors }
	}

	const domain = project['domain']
	const redirectDomains = project['redirect_domains']
	const filter = project['filter']

	return {
		ok: true,
		config: {
			project: {
				name: projectResult.name,
				type: projectResult.type,
				filter: isScriptValue(filter) ? filter : false,
				domain: typeof domain === 'string' ? domain : undefined,
				redirectDomains: Array.isArray(redirectDomains)
					? redirectDomains.filter(
							(entry): entry is string =>
								typeof entry === 'string',
						)
					: [],
			},
			scripts: {
				lint: resolveScript(
					scriptsResult.scriptValues['lint'],
					DEFAULT_SCRIPTS.lint,
				),
				test: resolveScript(
					scriptsResult.scriptValues['test'],
					DEFAULT_SCRIPTS.test,
				),
				build: resolveScript(
					scriptsResult.scriptValues['build'],
					DEFAULT_SCRIPTS.build,
				),
			},
			package: pkgResult.packageSection,
			environment: {
				development: isBoolean(envResult.development)
					? envResult.development
					: DEFAULT_ENVIRONMENT.development,
			},
		},
	}
}

type ParseConfigResult =
	| { readonly ok: true; readonly config: NextNodeConfig }
	| { readonly ok: false; readonly errors: readonly string[] }
