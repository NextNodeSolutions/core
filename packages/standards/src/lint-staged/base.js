export default {
	"package.json": ["better-sort-package-json"],
	"*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,svelte,astro}": ["oxlint"],
	"*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue,svelte,astro,json}": [() => "oxfmt --write ."],
};
