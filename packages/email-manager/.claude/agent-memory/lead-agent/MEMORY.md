# Lead Agent Memory — email-manager

## Project Facts

- Package: `@nextnode-solutions/email-manager` (new scope, not @nextnode)
- Standards: `@nextnode-solutions/standards` v1.0.1 (oxlint, oxfmt, not biome/prettier)
- `@nextnode/logger` is NOT published to npm — requires `link:../logger` or local build
- Node.js >=24.0.0, pnpm@10.11.0, ESM-only
- Build: tsup, 4.95 KB ESM output

## Key Learnings

- **oxlint requires .gitignore**: Without it, oxlint scans node_modules (15K+ files, 82s, 138K warnings)
- **exactOptionalPropertyTypes**: When spreading optional boolean fields to @react-email/render Options, use conditional spread `...(val !== undefined && { key: val })` to avoid TS2345
- **vitest + linked packages**: Linked packages without dist fail at Vite import resolution. Use vitest.config.ts alias to mock: `'@nextnode/logger': resolve(__dirname, './__mocks__/@nextnode/logger.ts')`
- **Type declarations for unbuilt deps**: Create `types/nextnode-logger.d.ts` with `declare module` and include `types/**/*.d.ts` in tsconfig

## Architecture Decisions

- V1 is template-first only — no raw HTML send, no queue, no batch, no webhooks
- Result pattern everywhere: `{ success: true, data } | { success: false, error }` — never throw from public API
- Provider utils in base.ts: normalizeRecipient, validateMessage — shared across providers
- Fail-fast at setup (createProvider throws on invalid key), graceful at send (returns Result)
