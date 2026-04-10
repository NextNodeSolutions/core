export default {
	'package.json': ['better-sort-package-json'],
	'*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,svelte,astro}': [
		'oxlint',
		'oxfmt --write',
	],
	// Exclude package.json: the dedicated `package.json` key above already
	// handles it via better-sort-package-json. Letting oxfmt also run on
	// package.json causes a flip-flop — the two tools disagree on key order
	// and indentation, so every commit rewrites the file.
	'!(package).json': ['oxfmt --write'],
}
