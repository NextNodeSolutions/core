export interface NextNodeConfig {
	readonly project: ProjectSection;
	readonly scripts: ScriptsSection;
}

export interface ProjectSection {
	readonly name: string;
}

export interface ScriptsSection {
	readonly lint: string | false;
	readonly test: string | false;
	readonly build: string | false;
}

export const DEFAULT_SCRIPTS: ScriptsSection = {
	lint: "lint",
	test: "test",
	build: "build",
};

export interface RawConfig {
	project?: Record<string, unknown>;
	scripts?: Record<string, unknown>;
}

function isScriptValue(value: unknown): value is string | false {
	return typeof value === "string" || value === false;
}

function resolveScript(value: unknown, fallback: string | false): string | false {
	if (isScriptValue(value)) return value;
	return fallback;
}

/**
 * Validates and parses a raw config into a typed NextNodeConfig.
 * Returns a discriminated union — either the typed config or validation errors.
 */
export function parseConfig(raw: RawConfig): ParseConfigResult {
	const errors: string[] = [];
	const project = raw.project;

	if (!project) {
		return { ok: false, errors: ["[project] section is required"] };
	}

	const name = project["name"];

	if (!name || typeof name !== "string") {
		errors.push("project.name is required and must be a string");
	}

	const scripts = raw.scripts;
	if (scripts) {
		for (const key of ["lint", "test", "build"] as const) {
			const value = scripts[key];
			if (value !== undefined && !isScriptValue(value)) {
				errors.push(`scripts.${key} must be a string or false, got ${typeof value}`);
			}
		}
	}

	if (errors.length > 0 || typeof name !== "string") {
		return { ok: false, errors };
	}

	const scriptValues = scripts ?? {};

	return {
		ok: true,
		config: {
			project: { name },
			scripts: {
				lint: resolveScript(scriptValues["lint"], DEFAULT_SCRIPTS.lint),
				test: resolveScript(scriptValues["test"], DEFAULT_SCRIPTS.test),
				build: resolveScript(scriptValues["build"], DEFAULT_SCRIPTS.build),
			},
		},
	};
}

type ParseConfigResult =
	| { readonly ok: true; readonly config: NextNodeConfig }
	| { readonly ok: false; readonly errors: readonly string[] };
