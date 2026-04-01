# @nextnode/standards — Spec

## Overview

A centralized, ESM-only configuration package that provides shared development standards for all NextNode projects. It replaces the previous Biome + Prettier stack with **oxlint** (linting) and **oxfmt** (formatting), and exports configs for TypeScript, Tailwind CSS, Vitest, commitlint, and lint-staged/husky.

## Context

The existing `@nextnode/standards` package (v2.2.1) uses Biome for linting and Prettier for formatting. This is a clean-break rewrite that:

- Drops Biome and Prettier entirely
- Adopts oxlint + oxfmt as the sole lint/format toolchain
- Adds a Tailwind CSS preset (the previous version only had a Prettier plugin for class sorting)
- Keeps the same scoped export pattern (`@nextnode/standards/<category>/<variant>`)
- Aligns with NextNode infrastructure (semantic-release via Dagger, `nextnode.toml`-driven CI)

## Functional Requirements

### Package Structure

- **FR-1**: The package is named `@nextnode/standards`, type `module`, Node.js `>=24.0.0`, pnpm as package manager.
- **FR-2**: No build step — configs are exported directly as JS/JSON source files from `src/`.
- **FR-3**: The package uses semantic-release for versioning (via NextNode CI pipeline), not changesets.

### Oxlint Configuration

- **FR-4**: Export a base oxlint config at `@nextnode/standards/oxlint` (`src/oxlint/base.json`).
- **FR-5**: The config enforces strict rules migrated from the reference Biome config:
    - `no-explicit-any`: error
    - `no-unused-vars`: error (with `ignoreRestSiblings`)
    - `no-unused-imports`: error (via oxlint's import plugin)
    - `use-const`: error (prefer `const` over `let`)
    - `no-var`: error
    - `no-debugger`: error
    - `no-console`: warn
    - `no-double-equals`: error (`===` required)
    - `use-template`: error (template literals over concatenation)
    - `use-import-type`: error (separate type imports)
    - `no-delete`: error (performance)
    - `use-arrow-function`: error
    - `no-excessive-cognitive-complexity`: error
    - `use-exhaustive-dependencies`: warn (React hooks)
    - `use-hook-at-top-level`: error (React hooks)
- **FR-6**: Additional stricter rules beyond the reference:
    - `explicit-function-return-type`: error (on exported functions only)
    - `no-magic-numbers`: error (with `ignore: [0, 1, -1]` and `ignoreEnums: true`)
- **FR-7**: Import organization/sorting rules matching the reference grouping:
    1. React imports
    2. Next.js imports
    3. Astro imports
    4. Node built-in modules
    5. External packages
    6. Internal aliases (`@/*`)
    7. Relative imports
    8. Type imports (mirroring the same group order)
- **FR-8**: Overrides for test/config files:
    - `no-console`: off
    - `no-explicit-any`: warn
    - `no-magic-numbers`: off
- **FR-9**: Overrides for `tsconfig*.json`: allow JSON comments and trailing commas.

### Oxfmt Configuration

- **FR-10**: Export a base oxfmt config at `@nextnode/standards/oxfmt` (`src/oxfmt/base.json`).
- **FR-11**: Formatting rules matching the reference Prettier config:
    - `useTabs`: true
    - `tabWidth`: 4
    - `endOfLine`: lf
    - `printWidth`: 80
    - `trailingComma`: all
    - `semi`: false
    - `arrowParens`: avoid (single param)
    - `bracketSpacing`: true
    - `singleQuote`: true
    - `jsxSingleQuote`: false
- **FR-12**: JSON override: trailing commas disabled for `*.json` files.
- **FR-13**: Tailwind CSS class sorting enabled via oxfmt's built-in support (if available) or plugin.

### TypeScript Configurations

- **FR-14**: Export 3 TypeScript configs:
    - `@nextnode/standards/typescript/library` — `src/typescript/tsconfig.library.json`
    - `@nextnode/standards/typescript/nextjs` — `src/typescript/tsconfig.nextjs.json`
    - `@nextnode/standards/typescript/astro` — `src/typescript/tsconfig.astro.json`
- **FR-15**: Library config (strictest):
    - Target: ES2023, Module: ESNext, moduleResolution: bundler
    - All strict flags: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`
    - ESM: `isolatedModules`, `verbatimModuleSyntax`
    - Compat: `forceConsistentCasingInFileNames`, `allowSyntheticDefaultImports`, `esModuleInterop`, `resolveJsonModule`, `skipLibCheck`, `allowJs`
    - `noEmit`: true
- **FR-16**: Next.js config:
    - Target: ES2023, lib: DOM + ESNext, Module: ESNext
    - JSX: preserve, incremental: true
    - Strict mode enabled but less strict than library (no `exactOptionalPropertyTypes`, no `noUncheckedSideEffectImports`)
    - `noEmit`: true
- **FR-17**: Astro config:
    - Extends `astro/tsconfigs/strict`
    - Target: ES2022, Module: preserve, moduleDetection: force
    - Full strict mode + `noUncheckedIndexedAccess`, `noImplicitOverride`
    - `noEmit`: true

### Tailwind CSS Theme (v4 CSS-first)

- **FR-18**: Export a CSS theme file at `@nextnode/standards/tailwind` (`src/tailwind/theme.css`).
- **FR-19**: The theme is brand-agnostic — no NextNode colors or fonts. It provides:
    - `--breakpoint-xs: 30rem` (extra-small breakpoint for mobile-first layouts)
- **FR-20**: Consuming projects import it in their main CSS file:
    ```css
    @import 'tailwindcss';
    @import '@nextnode-solutions/standards/tailwind';
    ```

### Vitest Configurations

- **FR-21**: Export 2 Vitest configs with dual (JS + types) exports:
    - `@nextnode/standards/vitest/frontend` — `src/vitest/vitest.frontend.js` + `.d.ts`
    - `@nextnode/standards/vitest/backend` — `src/vitest/vitest.backend.js` + `.d.ts`
- **FR-22**: Frontend config:
    - Environment: jsdom
    - `globals`: true, `restoreMocks`: true, `clearMocks`: true, `unstubGlobals`: true, `mockReset`: false
    - Coverage: v8 provider, reporters `['json', 'html', 'text']`, enabled by default
    - Coverage excludes: test files, node_modules, dist, .astro, coverage, tests, config, types dirs
- **FR-23**: Backend config:
    - Environment: node, `NODE_ENV`: test
    - Same mock settings as frontend
    - Coverage: v8 provider, reporters `['text', 'json', 'html']`
    - Coverage excludes: node_modules, dist, .d.ts, test/spec files, config files, types.ts

### Commitlint Configuration

- **FR-24**: Export a commitlint config at `@nextnode/standards/commitlint` (`src/commitlint/base.js`).
- **FR-25**: Extends `@commitlint/config-conventional` with:
    - Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
    - Rules: type-case lowercase, subject-empty never, header-max-length 100, body/footer-leading-blank, body/footer-max-line-length 100, no period at end of subject

### Lint-Staged Configuration

- **FR-26**: Export a lint-staged config at `@nextnode/standards/lint-staged` (`src/lint-staged/base.js`).
- **FR-27**: The config runs:
    - `package.json`: `better-sort-package-json`
    - `*`: oxlint check + oxfmt format

### Git Hooks (Husky)

- **FR-28**: The standards repo itself uses husky with 3 hooks:
    - `commit-msg`: run commitlint
    - `pre-commit`: run lint-staged
    - `pre-push`: run tests
- **FR-29**: These hooks are internal to the standards repo. Consuming projects set up their own husky instance but import the lint-staged and commitlint configs from this package.

### Package Exports Map

- **FR-30**: Complete `exports` field in `package.json`:
    ```json
    {
    	"./oxlint": "./src/oxlint/base.json",
    	"./oxfmt": "./src/oxfmt/base.json",
    	"./typescript/library": "./src/typescript/tsconfig.library.json",
    	"./typescript/nextjs": "./src/typescript/tsconfig.nextjs.json",
    	"./typescript/astro": "./src/typescript/tsconfig.astro.json",
    	"./tailwind": "./src/tailwind/theme.css",
    	"./vitest/frontend": {
    		"types": "./src/vitest/vitest.frontend.d.ts",
    		"default": "./src/vitest/vitest.frontend.js"
    	},
    	"./vitest/backend": {
    		"types": "./src/vitest/vitest.backend.d.ts",
    		"default": "./src/vitest/vitest.backend.js"
    	},
    	"./commitlint": "./src/commitlint/base.js",
    	"./lint-staged": "./src/lint-staged/base.js"
    }
    ```

### CI/CD Integration

- **FR-31**: Include a `nextnode.toml` at the repo root:

    ```toml
    [project]
    name = "standards"
    type = "package"

    [package]
    scope = "@nextnode"
    access = "public"
    canary_on_label = true
    ```

- **FR-32**: Include the standard 10-line CI workflow at `.github/workflows/ci.yml` calling the reusable pipeline.
- **FR-33**: Package scripts:
    - `lint`: oxlint check
    - `format`: oxfmt format
    - `format:check`: oxfmt check
    - `test`: echo (config package, no tests)
    - `build`: echo (no build step)
    - `prepare`: husky

## Data Model

N/A — this is a configuration package with no runtime data.

## API Contract

N/A — no HTTP API. The "API" is the package exports map (FR-30).

## UI/UX Requirements

N/A — CLI tooling package.

## Edge Cases

- **EC-1**: oxfmt may not yet support Tailwind class sorting natively. If not available at implementation time, document it as a known limitation and add a TODO. Do not fall back to Prettier.
- **EC-2**: oxlint config format may differ from the JSON format described. Adapt FR-4 through FR-9 to whatever config format oxlint actually supports (JSON, YAML, or JS).
- **EC-3**: Some oxlint rules may not have exact equivalents for all Biome rules. Map to the closest available rule and document any gaps in a `MIGRATION.md` file.
- **EC-4**: The `explicit-function-return-type` rule should only apply to exported functions, not internal/private functions. If oxlint doesn't support this granularity, apply it globally and document the difference.

## Security

N/A — configuration package with no runtime code execution, no user input handling, no network access.

## Performance

- No build step required — configs are consumed directly
- Peer dependencies keep the package lightweight
- No transitive runtime dependencies

## Dependencies

### Peer Dependencies (all optional except oxlint)

| Package                           | Version              | Required |
| --------------------------------- | -------------------- | -------- |
| `oxlint`                          | latest stable        | Yes      |
| `oxfmt`                           | latest stable        | Yes      |
| `@commitlint/cli`                 | `^19.0.0`            | Optional |
| `@commitlint/config-conventional` | `^19.0.0`            | Optional |
| `vitest`                          | `^3.0.0 \|\| ^4.0.0` | Optional |
| `tailwindcss`                     | `^4.0.0`             | Optional |

### Dev Dependencies

| Package                           | Purpose                    |
| --------------------------------- | -------------------------- |
| `oxlint`                          | Linting                    |
| `oxfmt`                           | Formatting                 |
| `@commitlint/cli`                 | Commit message validation  |
| `@commitlint/config-conventional` | Conventional commits base  |
| `husky`                           | Git hooks                  |
| `lint-staged`                     | Pre-commit file processing |
| `better-sort-package-json`        | package.json field sorting |

## Out of Scope

- Vite build configurations (deferred to a future version)
- NextNode brand tokens in Tailwind preset (brand-agnostic by design)
- Biome or Prettier configs (clean break)
- Changesets (using semantic-release via NextNode CI)
- Runtime utilities or helper functions
- Editor/IDE config files (`.editorconfig`, `.vscode/`)
- GitHub Actions workflow files beyond the standard CI caller

## Open Questions

None — all decisions resolved during interview.
