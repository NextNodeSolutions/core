const linted = 'js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,svelte'

export default {
	'package.json': ['better-sort-package-json'],
	[`*.{${linted}}`]: ['oxlint', 'oxfmt --write'],
	// oxfmt 0.43.x does not support .astro files - it errors with
	// "Expected at least one target file" when asked to format them.
	// Run oxlint only on .astro until oxfmt gains astro support.
	'*.astro': ['oxlint'],
	// Every other file goes to oxfmt, which skips the types it does not know, so a commit
	// passes the same `oxfmt --check .` as CI (Markdown, YAML, TOML, CSS...). package.json
	// stays out: better-sort-package-json owns it and the two tools flip-flop its format.
	// The globs are disjoint, because lint-staged runs the globs matching a file concurrently.
	[`!(package.json|*.@(${linted.replaceAll(',', '|')}|astro))`]: [
		'oxfmt --write --no-error-on-unmatched-pattern',
	],
}
