import type { PipelineEnvironment } from '#/domain/environment.ts'

/**
 * Compute the Cloudflare Pages project name for a given environment.
 *
 * Each deployable environment gets its own Pages project for strict
 * isolation (distinct deploy history, analytics, and custom domains):
 * - Production: `{baseName}`         (e.g. "gardefroidclim")
 * - Development: `{baseName}-dev`    (e.g. "gardefroidclim-dev")
 * - None (package): `{baseName}` unchanged — packages don't deploy to Pages
 *
 * Both projects use `main` as their own production branch. They are
 * distinct CF projects, so there is no conflict: deploys always go to
 * `--branch=main`; environment selection happens at the PROJECT level.
 */
export function computePagesProjectName(
	baseName: string,
	environment: PipelineEnvironment,
): string {
	if (environment === 'development') return `${baseName}-dev`
	return baseName
}
