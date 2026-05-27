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
		customGroups: [
			{
				groupName: 'framework',
				modifiers: ['value'],
				elementNamePattern: [
					'react',
					'react-dom',
					'react/**',
					'react-dom/**',
					'next',
					'next/**',
					'astro',
					'astro/**',
					'astro:**',
				],
			},
		],
		groups: [
			['builtin', 'framework'],
			['external'],
			['internal'],
			['parent'],
			['sibling'],
			['index'],
			['type-builtin'],
			{ newlinesBetween: false },
			['type-external'],
			{ newlinesBetween: false },
			['type-internal'],
			{ newlinesBetween: false },
			['type-parent', 'type-sibling', 'type-index'],
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
