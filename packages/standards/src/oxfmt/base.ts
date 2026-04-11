export default {
	useTabs: true,
	tabWidth: 4,
	endOfLine: 'lf',
	printWidth: 80,
	trailingComma: 'all',
	semi: false,
	arrowParens: 'avoid',
	bracketSpacing: true,
	singleQuote: true,
	jsxSingleQuote: false,
	bracketSameLine: false,
	// oxfmt has a built-in package.json key sorter (triggered by filename).
	// It is incompatible with `better-sort-package-json` which lint-staged
	// runs on commit: the two tools disagree on both key order and
	// indentation, producing a flip-flop that rewrites package.json on
	// every bulk format run. Ignoring package.json at the oxfmt layer lets
	// `better-sort-package-json` own the file exclusively.
	ignorePatterns: ['package.json'],
	experimentalTailwindcss: {},
	experimentalSortImports: {
		groups: [
			['builtin'],
			['external', 'type-external'],
			['internal', 'type-internal'],
			['parent', 'type-parent'],
			['sibling', 'type-sibling'],
			['index', 'type-index'],
		],
		newlinesBetween: true,
	},
	overrides: [
		{
			files: ['*.json'],
			options: {
				trailingComma: 'none',
			},
		},
	],
}
