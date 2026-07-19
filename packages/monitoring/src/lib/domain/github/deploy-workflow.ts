/**
 * Pure detection of "VPS deploy" workflows. A repo workflow counts as a VPS
 * deploy pipeline when its YAML calls the reusable deploy workflow
 * (core's `.github/workflows/deploy.yml`) via a `uses:` line - either the
 * local `./.github/workflows/deploy.yml` form (core itself) or the
 * cross-repo `NextNodeSolutions/core/.github/workflows/deploy.yml@ref` form
 * (client repos). Callers of `deploy-static.yml` (Cloudflare Pages) must NOT
 * match: those deployments already surface through the Cloudflare API and
 * would duplicate in the merged activity feed.
 */

/** One workflow of a repo, as the GitHub Actions workflows API lists it. */
export interface DeployWorkflow {
	readonly id: number
	readonly name: string
	readonly path: string
}

// A `uses:` line whose value ends in `/deploy.yml` (optionally `@ref`,
// optionally quoted). The mandatory `/` right before `deploy.yml` keeps
// `redeploy.yml` or `deploy-static.yml` callers out.
const REUSABLE_DEPLOY_USES =
	/^\s*(?:-\s*)?uses:\s*['"]?\S*\/deploy\.yml(?:@\S+)?['"]?\s*$/m

export const referencesReusableDeployWorkflow = (yamlText: string): boolean =>
	REUSABLE_DEPLOY_USES.test(yamlText)
