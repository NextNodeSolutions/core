/**
 * Every NextNode VPS joins the tailnet as a single `tag:server`.
 *
 * `tag:server` is the historical tag the provisioning OAuth client is permitted
 * to mint and the existing ACL grants (CI SSH over the tailnet) key on. We
 * deliberately do NOT mint per-role tags (`tag:client-vps` / `tag:monitoring`):
 * a new tag requires declaring `tagOwners` AND re-issuing the OAuth client (its
 * tags are immutable) in the tailnet admin console - a manual, per-tailnet step
 * that breaks the "100% automatic, reproducible on any VPS" contract. The
 * monitoring SD selects scrape targets by `tag:server` instead, and tells the
 * observability host apart from workload VPS via the R2 state, not a tag.
 */
export const SERVER_TAG = 'tag:server'

export function computeTailscaleTags(): ReadonlyArray<string> {
	return [SERVER_TAG]
}
