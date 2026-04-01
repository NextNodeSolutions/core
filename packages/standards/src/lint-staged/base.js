export default {
	'package.json': ['better-sort-package-json'],
	'*': ['oxlint'],
	'*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}': ['oxfmt --write'],
}
