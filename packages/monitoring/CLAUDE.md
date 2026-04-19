# @nextnode-solutions/monitoring

## What This Is

NextNode's internal control-plane dashboard. A small interactive Astro web app
deployed on a Hetzner VPS and reachable **only through Tailscale** at
`monitoring.nextnode.fr`. The operator uses it to manage every NextNode
project and VPS in one place.

Two responsibilities:

1. **Manage GitHub projects** — trigger workflow dispatches, approve prod
   deploys, delete projects, destroy Hetzner VPS.
2. **Monitor projects** — Hetzner VPS health (logs, CPU, memory, disk),
   Cloudflare Pages / Workers stats via wrangler, clean data/stats views.

**This package is NEVER published to npm.** It runs as a container on its
own Hetzner VPS, built and deployed by the reusable `deploy.yml` workflow
from `@nextnode/core`.

## Previous attempt — read this before changing direction

An earlier version lives on branch `feat/monitoring-package` (last commits
`91594d7 fix: align monitoring schema with restructured config types` and
`81e0dcb docs(monitoring): pivot Step 10 to Astro dashboard, pick FB`).
That branch built a completely different thing: a multi-tenant log /
uptime pipeline with Vector agents shipping NDJSON into VictoriaLogs over
Tailscale, probe scheduler, SLO-driven vmalert rules, and a Hono webhook
service. It was scrapped for two reasons:

1. It grew into a gloubi-boulga — four half-finished layers (ingest API,
   probe, rules generator, webhook) coupled to a plan doc that kept
   pivoting (Hono ingest → killed → Vector pull → half-implemented).
2. `packages/infrastructure` evolved significantly since the branch was
   opened (teardown workflows, internal/external Caddy split, config
   schema restructure). A rebase would have been more painful than a
   fresh start.

The current package is a **complete reset**: an Astro web UI, not a
background agent. If you catch yourself re-implementing probes, Vector
configs, or SLO rule generators here — stop. Those belong in their own
package if they come back at all, and the old plan doc
(`docs/monitoring-plan.md` on `feat/monitoring-package`) is worth reading
before re-proposing them.

## Target architecture

```
Operator (laptop, on tailnet)
        │  HTTPS via Tailscale
        ▼
monitoring.nextnode.fr  (A-record → tailnet IP)
        │
        ▼
Caddy on monitoring VPS (Tailscale-only listener, internal cert)
        │
        ▼
Astro node standalone server (PORT=3000, service name "app")
        │
        ├──► GitHub API (workflow dispatch, deploy approvals, repo delete)
        ├──► Hetzner Cloud API (server describe, destroy)
        ├──► SSH to client VPSs (logs tail, metrics probe) — read-only
        └──► wrangler (Cloudflare Pages / Workers stats)
```

- **`nextnode.toml`**: `type = "app"`, `internal = true`. That single flag
  drives DNS (tailnet IP, not public), firewall (tailscale0 only, no
  `80/443` on public), and Caddy cert strategy in `@nextnode-solutions/infrastructure`.
- **Domain**: `monitoring.nextnode.fr` resolved internally to a tailnet IP.
- **No auth layer on the app itself** (for now): Tailscale membership is
  the trust boundary. If the dashboard ever surfaces multi-user actions,
  revisit.

## Architecture — STRICT LAYERED RULE

Mirrors `packages/infrastructure` — same layers, same import rules.

```
src/
  pages/              — Astro routes (UI pages + API endpoints). THIN.
    index.astro       — Dashboard
    projects/[slug].astro — Per-project view with action forms
    vps/…             — VPS fleet pages
    cloudflare/…      — Cloudflare projects pages
    api/              — Server endpoints (POST/GET/DELETE). See RULE 4.
  layouts/            — Astro page layouts (<slot/> wrappers, per astro-skill RULE 12)
  components/         — Pure .astro components (props + scoped styles)
  lib/
    domain/           — PURE business logic. NO IO, NO env, NO logger
      project.ts      — ProjectSummary type (single source)
      api-result.ts   — NotImplementedResult + builders
    adapters/         — IO boundary: HTTP responses, GitHub, Hetzner, SSH
      json-response.ts — Response construction for API routes
      http-status.ts  — Named HTTP status constants
  styles/
    tokens.css        — Brand tokens (teal primary, orange accent, dark navy bg)
```

### Layer import rules

| Layer         | May import from                       | STRICTLY FORBIDDEN                                             |
| ------------- | ------------------------------------- | -------------------------------------------------------------- |
| `pages/`      | `lib/domain`, `lib/adapters`, `layouts/`, `components/` | direct `fetch`, raw `process.env` outside adapter wrappers     |
| `components/` | `lib/domain` (types only)             | any IO, env, logger                                            |
| `lib/domain/` | other `lib/domain/*`                  | `process.env`, `node:fs`, `fetch`, logger, any adapter         |
| `lib/adapters/` | `lib/domain/*` (types only), stdlib | domain business decisions                                      |

### Hard rules

- **Pages are thin orchestrators.** A page reads `Astro.params`, calls
  `lib/` to fetch data + call domain, renders. No business logic in
  `.astro` frontmatter beyond layout glue.
- **API routes mirror the deploy skill's CLI pattern** — each file is a
  thin command: read input, call domain, hand result to an adapter.
- **Domain is 100% pure.** No `Date.now()` or `crypto.randomBytes()` in
  business functions — inject them as parameters so tests stay
  deterministic. Domain tests need no mocks beyond plain fixtures.
- **Adapters never decide.** They translate IO (HTTP, GitHub API, Hetzner
  API, SSH, wrangler subprocess) to/from domain types. Conditionals
  beyond "did the IO succeed?" are a smell — push them into domain.
- **HTTP status codes are constants.** See `lib/adapters/http-status.ts`.
  Magic numbers are banned by oxlint.
- **Path alias `@/*` → `src/*`.** Use it everywhere; avoid deep relative
  chains like `../../../..`.

### Naming

- `lib/domain/<concept>.ts` — named after the concept it owns
  (`project.ts`, `api-result.ts`), never `utils.ts` / `helpers.ts`.
- `lib/adapters/<io-concept>.ts` — named after the IO it performs
  (`json-response.ts`, `github-client.ts`, `hetzner-client.ts`).
- `components/<Thing>.astro` — PascalCase.
- `pages/api/**` — mirror the logical resource tree
  (`projects/[slug]/workflows/dispatch.ts`).

### When adding a feature

1. Add the pure type + function in `lib/domain/`, with a unit test.
2. Add or extend an adapter in `lib/adapters/` if new IO is needed.
3. Wire them together in the page or API route.
4. No layer skips.

## Astro specifics

- **`output: 'server'` with `@astrojs/node` standalone.** Every page and API
  route must `export const prerender = false` — this is an internal dashboard,
  static prerendering has no value.
- **Astro 5.** The project tsconfig extends `@nextnode-solutions/standards/typescript/astro`.
  Do NOT use `hybrid` output mode (removed in Astro 5).
- **No client framework** (React/Vue/Svelte) unless interactivity demands
  it. Forms post directly to API routes, server re-renders. If a panel
  ever needs live updates, add a narrow framework integration
  (`integrations: [react({ include: ['**/panels/**'] })]`) per
  the astro-skill RULE 3.
- **Scoped styles default.** Global-ish tokens live in
  `src/styles/tokens.css`, imported once in `BaseLayout.astro`.
- **`astro check` is part of the Definition of Done.** `tsc` does NOT
  catch errors in `.astro` files. The `type-check` script runs it.

## Error Handling

Follow the global CLAUDE.md rules verbatim:

- No silent swallows. Every error is logged and propagated.
- No technical fallbacks without explicit business rule.
- API routes map adapter errors to a specific HTTP status at the boundary
  (auth failure → 401, upstream down → 502/503, validation → 400, not
  found → 404) — never a silent empty success.

## Testing

- **Domain tests**: pure unit tests, plain value fixtures, no mocks.
- **Adapter tests**: `vi.stubGlobal('fetch', …)` for HTTP adapters, temp
  dirs for filesystem-backed state.
- **API route tests**: end-to-end of a single endpoint via
  `experimental_AstroContainer` or the built-in request pipeline — set env,
  call the handler, assert on `Response.status` + parsed JSON body.
- **UI**: `.astro` components are best tested through the pages that
  render them; prefer Playwright / Astro container over jsdom where UI is
  complex. None yet — add when a component grows logic.
- Uses vitest with `@nextnode-solutions/standards/vitest/astro`.

## Deployment

- Dockerfile + `docker-compose.yml` at the package root follow the
  hetzner-caller convention (`services.app`, `build.context` points at
  the monorepo root so pnpm workspaces resolve, no `image:` / `ports:` /
  `env_file:` / `restart:` — all injected by the infra pipeline).
- The container binds `$PORT=3000`; the VPS-side Caddy reverse-proxies
  `monitoring.nextnode.fr` to `127.0.0.1:<computeHostPort('production')>`.
- Secrets (`GITHUB_APP_PRIVATE_KEY`, `HETZNER_API_TOKEN`, `CLOUDFLARE_API_TOKEN`,
  etc.) are declared in `[deploy].secrets` once wired; until then, the
  dashboard's stubs return 501.

## Reference

- `packages/infrastructure/CLAUDE.md` — the architecture pattern this
  package copies.
- `docs/infra-topology.md` — target VPS topology for all NextNode projects.
- `/nextnode-deploy` skill (`hetzner-caller.md`) — Dockerfile / compose
  contract.
- `/astro` skill — Astro 5 rules (especially rendering mode, env vars,
  api-routes, and styling).
- Previous attempt: branch `feat/monitoring-package` in this repo.
