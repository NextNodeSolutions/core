# CLAUDE.md

## Project Overview

`@nextnode-solutions/email-manager` — A TypeScript email management library with a template-first API for sending emails via React Email templates. Provider-agnostic architecture with Resend as the first implementation.

## Development Commands

```bash
pnpm build           # Build with tsup (minified ESM + .d.ts)
pnpm lint            # Lint with oxlint
pnpm format          # Format with oxfmt
pnpm type-check      # TypeScript validation
pnpm test            # Run tests with Vitest
pnpm test:coverage   # Run tests with coverage
pnpm test:watch      # Watch mode
```

## Architecture

- **Entry Point**: `src/index.ts` — all public exports
- **Facade**: `src/email-manager.ts` — `createEmailManager()` factory
- **Providers**: `src/providers/` — provider interface + Resend implementation
- **Templates**: `src/templates/renderer.ts` — React Email rendering
- **Types**: `src/types/` — all TypeScript type definitions
- **Utils**: `src/utils/logger.ts` — scoped loggers via @nextnode-solutions/logger

## Key Patterns

- Result pattern: `{ success: true, data } | { success: false, error }` — never throw from public API
- Provider interface: `EmailProvider` with `send()` and `validateConfig()`
- Template-first: every email uses a React Email component, rendered to HTML internally
- Peer deps: react, @react-email/render, @nextnode-solutions/logger

## Tooling

- **Build**: tsup (ESM-only, minified)
- **Lint**: oxlint (extends @nextnode-solutions/standards/oxlint)
- **Format**: oxfmt (extends @nextnode-solutions/standards/oxfmt)
- **Test**: vitest (extends @nextnode-solutions/standards/vitest/backend)
- **Commits**: conventional commits via commitlint + husky
