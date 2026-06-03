import { formatImageRef } from './image-ref.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { ImageRef } from './target.ts'

// docker buildx bake resolves a target's `dockerfile` relative to its
// `context`. We write the bake file at the repo root (the bake-action working
// directory), so the default context is the repo root and the default
// Dockerfile sits at `<packageDir>/Dockerfile` — the NextNode monorepo
// convention (turbo prune needs the whole workspace as context).
const DEFAULT_BUILD_CONTEXT = '.'
const DOCKERFILE_BASENAME = 'Dockerfile'

// One bake target: the build inputs (context/dockerfile/stage) plus the
// computed publish tag and the per-target GitHub Actions layer cache scope.
interface BakeTarget {
	readonly context: string
	readonly dockerfile: string
	// Docker build STAGE (`--target`). Absent → build the Dockerfile's final
	// stage. Only emitted when the service declares an explicit stage.
	readonly target?: string
	// Build args (`--build-arg`) for this target: the infra's default public
	// args plus the service's resolved `build_args`. Absent when the target has
	// none. Values are inlined into the image — never put secrets here.
	readonly args?: Readonly<Record<string, string>>
	readonly tags: ReadonlyArray<string>
	readonly 'cache-from': ReadonlyArray<string>
	readonly 'cache-to': ReadonlyArray<string>
}

// A docker-bake definition file (JSON form): the `default` group lists every
// target so `docker buildx bake` with no target argument builds them all.
interface BakeDefinition {
	readonly group: {
		readonly default: { readonly targets: ReadonlyArray<string> }
	}
	readonly target: Readonly<Record<string, BakeTarget>>
}

export interface RenderBakeFileInput {
	// Every declared service, by instance name — used to read each build
	// target's context/dockerfile/stage overrides.
	readonly services: Readonly<Record<string, UserServiceConfig>>
	// Resolved image ref per service (the build refs become the bake tags).
	readonly imageRefs: Readonly<Record<string, ImageRef>>
	// Instance names of the `build` services — the exact set of bake targets.
	readonly bakeTargets: ReadonlyArray<string>
	// The calling project's package directory relative to the repo root
	// (e.g. `packages/monitoring`), used to default the Dockerfile path.
	readonly packageDir: string
	// Resolved build args per build service (instance name → arg name → value).
	// A service absent from the map (or mapped to an empty record) bakes with no
	// build args. See `resolveBuildArgs`.
	readonly buildArgs: Readonly<
		Record<string, Readonly<Record<string, string>>>
	>
}

/**
 * Render the docker-bake definition (JSON) that drives the build job —
 * `nextnode.toml` is the single source of truth for build shape, so the
 * caller needs no docker-compose.yml. Each `build` service becomes a bake
 * target carrying its build inputs (context/dockerfile/stage from the toml,
 * with monorepo defaults), its computed GHCR tag, and a GHA layer cache scope.
 * `upstream` services are pulled, never built, so they never appear here.
 */
export function renderBakeFile(input: RenderBakeFileInput): string {
	if (input.bakeTargets.length === 0) {
		throw new Error(
			'renderBakeFile: no build services to bake — compute-image-ref runs only when at least one service has source = "build"',
		)
	}

	const targets = Object.fromEntries(
		input.bakeTargets.map(name => [name, buildBakeTarget(name, input)]),
	)
	const definition: BakeDefinition = {
		group: { default: { targets: input.bakeTargets } },
		target: targets,
	}
	return JSON.stringify(definition, null, '\t')
}

function buildBakeTarget(name: string, input: RenderBakeFileInput): BakeTarget {
	const service = input.services[name]
	if (!service || service.source !== 'build') {
		throw new Error(
			`renderBakeFile: bake target "${name}" is not a declared build service`,
		)
	}
	const ref = input.imageRefs[name]
	if (!ref) {
		throw new Error(
			`renderBakeFile: bake target "${name}" has no resolved image ref`,
		)
	}

	const ghaCacheScope = `type=gha,scope=${name}`
	const args = input.buildArgs[name]
	return {
		context: service.context ?? DEFAULT_BUILD_CONTEXT,
		dockerfile: service.dockerfile ?? defaultDockerfile(input.packageDir),
		...(service.target !== undefined ? { target: service.target } : {}),
		...(args && Object.keys(args).length > 0 ? { args } : {}),
		tags: [formatImageRef(ref)],
		'cache-from': [ghaCacheScope],
		'cache-to': [`${ghaCacheScope},mode=max`],
	}
}

// `<packageDir>/Dockerfile`, or just `Dockerfile` when the project lives at the
// repo root (empty package dir) — never a leading-slash absolute path.
function defaultDockerfile(packageDir: string): string {
	if (packageDir === '') return DOCKERFILE_BASENAME
	return `${packageDir}/${DOCKERFILE_BASENAME}`
}
