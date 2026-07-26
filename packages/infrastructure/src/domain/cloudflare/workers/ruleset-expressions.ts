// The Cloudflare Rules-language fragments every zone rule family builds its
// expression from. Shared so the upstream ceiling and the public gate read the
// same path grammar: an exact path, or a trailing `*` standing for a prefix.

const PATH_FIELD = 'http.request.uri.path'
const PREFIX_WILDCARD = '*'

function pathPredicate(path: string): string {
	if (!path.endsWith(PREFIX_WILDCARD)) return `${PATH_FIELD} eq "${path}"`
	return `starts_with(${PATH_FIELD}, "${path.slice(0, -PREFIX_WILDCARD.length)}")`
}

// The declared paths as one predicate, in declaration order. Empty input yields
// an empty string - the caller decides what "no path" means for its family.
export function buildPathsExpression(paths: ReadonlyArray<string>): string {
	return paths.map(pathPredicate).join(' or ')
}

export function buildHostExpression(host: string): string {
	return `http.host eq "${host}"`
}
