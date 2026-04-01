# Iterations Log — nextnode-standards

## Iteration 1 — Full Package Implementation

**Status**: completed
**Items**: FR-1 through FR-33 (all spec items)
**Files created**: 18

### Changes

- `package.json` — full package config with exports map, deps, scripts (FR-1, FR-2, FR-3, FR-30, FR-33)
- `src/oxlint/base.json` — oxlint config with strict rules, overrides (FR-4 to FR-9)
- `src/oxfmt/base.json` — oxfmt config with formatting rules, Tailwind sorting, import sorting (FR-10 to FR-13)
- `src/typescript/tsconfig.library.json` — strictest TS config (FR-14, FR-15)
- `src/typescript/tsconfig.nextjs.json` — Next.js TS config (FR-14, FR-16)
- `src/typescript/tsconfig.astro.json` — Astro TS config (FR-14, FR-17)
- `src/tailwind/theme.css` — brand-agnostic Tailwind v4 CSS theme (FR-18 to FR-20)
- `src/vitest/vitest.frontend.js` + `.d.ts` — frontend Vitest config (FR-21, FR-22)
- `src/vitest/vitest.backend.js` + `.d.ts` — backend Vitest config (FR-21, FR-23)
- `src/commitlint/base.js` — commitlint config (FR-24, FR-25)
- `src/lint-staged/base.js` — lint-staged config (FR-26, FR-27)
- `.husky/commit-msg`, `.husky/pre-commit`, `.husky/pre-push` — git hooks (FR-28, FR-29)
- `.github/workflows/ci.yml` — CI workflow (FR-32)
- `nextnode.toml` — CI config (FR-31)
- `.oxlintrc.json`, `.oxfmtrc.json` — repo-level tool configs
- `.gitignore`, `commitlint.config.js` — repo infrastructure

### Rule Mapping Notes (EC-3)

Biome rules mapped to closest oxlint equivalents:

- `useConst` -> `eslint/prefer-const`
- `noDoubleEquals` -> `eslint/eqeqeq`
- `useTemplate` -> `eslint/prefer-template`
- `useImportType` -> `typescript/consistent-type-imports`
- `noDelete` -> `typescript/no-dynamic-delete`
- `useArrowFunction` -> `eslint/arrow-body-style`
- `noExcessiveCognitiveComplexity` -> `eslint/complexity`
- `useExhaustiveDependencies` -> `react/exhaustive-deps`
- `useHookAtTopLevel` -> `react/rules-of-hooks`
- `noUnusedImports` -> handled by `eslint/no-unused-vars` (oxlint lacks dedicated unused-imports rule)

### Validation

- oxlint: 0 warnings, 0 errors
- oxfmt: all files formatted correctly
- build: passed (no build step needed)
- test: passed (config package, no runtime tests)
