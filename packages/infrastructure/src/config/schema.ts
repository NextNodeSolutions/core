export interface NextNodeConfig {
	readonly project: ProjectSection
	readonly scripts: ScriptsSection
	readonly package: PackageSection | false
}

const PROJECT_TYPES = ['app', 'package'] as const
type ProjectType = (typeof PROJECT_TYPES)[number]

export interface ProjectSection {
	readonly name: string
	readonly type: ProjectType
	readonly filter: string | false
}

export interface ScriptsSection {
	readonly lint: string | false
	readonly test: string | false
	readonly build: string | false
}

export interface PackageSection {
	readonly access: string
}

export const DEFAULT_SCRIPTS: ScriptsSection = {
	lint: 'lint',
	test: 'test',
	build: 'build',
}

export interface RawConfig {
	project?: Record<string, unknown>
	scripts?: Record<string, unknown>
	package?: Record<string, unknown>
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

function resolveScript(
	value: unknown,
	fallback: string | false,
): string | false {
	if (isScriptValue(value)) return value
	return fallback
}

/**
 * Validates and parses a raw config into a typed NextNodeConfig.
 * Returns a discriminated union — either the typed config or validation errors.
 */
export function parseConfig(raw: RawConfig): ParseConfigResult {
	const errors: string[] = []
	const project = raw.project

	if (!project) {
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

	const scripts = raw.scripts
	if (scripts) {
		for (const key of ['lint', 'test', 'build'] as const) {
			const value = scripts[key]
			if (value !== undefined && !isScriptValue(value)) {
				errors.push(
					`scripts.${key} must be a string or false, got ${typeof value}`,
				)
			}
		}
	}

	if (errors.length > 0 || typeof name !== 'string' || !isProjectType(type)) {
		return { ok: false, errors }
	}

	const scriptValues = scripts ?? {}
	const pkg = raw.package

	let packageSection: PackageSection | false = false
	if (pkg) {
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

	return {
		ok: true,
		config: {
			project: {
				name,
				type,
				filter: isScriptValue(filter) ? filter : false,
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
		},
	}
}

type ParseConfigResult =
	| { readonly ok: true; readonly config: NextNodeConfig }
	| { readonly ok: false; readonly errors: readonly string[] }
