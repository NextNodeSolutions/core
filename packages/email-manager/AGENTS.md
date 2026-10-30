# AGENTS.md

These rules cover the email library, where an email manager renders React Email templates and sends them through provider adapters chosen by a provider registry. [README.md](README.md) explains usage, [docs/architecture.md](docs/architecture.md) the parts and their contracts, and the [root AGENTS.md](../../AGENTS.md) the monorepo rules.

## Invariants

- **Never throw from `send`, `renderTemplate`, an adapter's `send` or `validateConfig`. Return a failure result, or `false` from `validateConfig`.** Callers send from request handlers and branch on `success`, so a throw crashes exactly the request the result type exists to protect.
- **Throw only during setup, from the provider registry.** An unknown provider, a missing key or an uninstalled SDK makes every send impossible, and failing at boot surfaces it before any email is lost.
- **Keep the email manager unaware of concrete providers. It talks only to the provider registry and the `EmailProvider` interface.** Adding a provider must never change the send flow.
- **Load a provider SDK only through the registry's dynamic import, and import it in the adapter for types only.** SDKs are optional peers, and a static import would make the package fail to load for every consumer who skipped that SDK.
- **Declare every package the library imports at runtime as a peer dependency, mirrored in `devDependencies`. Never add `dependencies`.** The host application must own the versions and hold a single copy of React and of each SDK.
- **Mark a provider SDK optional in `peerDependenciesMeta`. Make a package the library imports statically a required peer.** Consumers then install only the SDKs they use.
- **Take every setting from function arguments. Never read `process.env` or files.** Each host application has its own secret handling. The registry's empty-key check also stops the Resend SDK from falling back to its environment variable.
- **Default to a silent logger, and hand adapters a `PROVIDER`-scoped child of the manager's logger.** A library must not print into its host's output unless the host asks.
- **Log message IDs, recipient counts, error codes and error messages only. Never log addresses, subjects, bodies, headers or keys.** Logs leave the process and outlive the email. The manager logs the message of every failure, so never put a secret or an address in an `EmailError` message.
- **Return a failure from the renderer or an adapter unchanged.** The code and original error set where the failure happened are the only accurate account of it.
- **Give every adapter failure an `EmailErrorCode`, the provider name and the original error when there is one.** Callers switch on the code, and the provider name and original error are the only debugging context they get.
- **Keep the recipient cap in the shared provider helpers and the render defaults in the template renderer, and nowhere else.** A copied value drifts from the one that runs.
- **Expose everything through the single package entry point. Add no subpath export.** The `exports` map and the build entry together are the published contract.

## Traps

- **Build the workspace dependencies before running type-check, lint or test.** They resolve `@nextnode-solutions/logger` from its built output and fail with "Cannot find module" without it. `type-check` is not a turbo task, so nothing builds it for you.
- **Check the returned `error` field of every Resend SDK call, not only `catch`.** The SDK returns API and network errors as values. The Resend adapter's credentials check ignores that field, which [docs/providers/resend.md](docs/providers/resend.md#check-credentials) describes.
- **The provider registry's dispatch on the name does not narrow the provider config.** Once `ProviderConfigMap` has several entries, the config is a union in every branch. Narrow it with a type guard, because the shared lint config forbids `as`.
- **The renderer calls the template as a plain function, not as a React component.** A hook in a template's own body throws and becomes `TEMPLATE_ERROR`, so test templates must keep hooks in nested components.
- **The manager copies the outgoing message field by field.** A new message field that the manager does not copy never reaches a provider, and no type error warns you.

## Adding a provider

1. Add the provider's config type and its entry in `ProviderConfigMap`. The entry's key is the name callers pass as `provider`, and it types `providerConfig`.
2. Add the SDK as an optional peer dependency and as a devDependency.
3. Write the adapter beside the existing ones, named after the provider. It receives a built client and a logger and returns an `EmailProvider`.
    - Run the shared message validation first and return its failure unchanged.
    - Map `EmailMessage` to the SDK payload with the shared recipient helpers. Leave absent optional fields out of the payload.
    - Classify both returned and thrown SDK errors into `EmailErrorCode` values with ordered rules, falling back to `PROVIDER_ERROR`.
    - On success return the provider's message ID, the provider name and the send time.
    - Implement `validateConfig` with one cheap authenticated read that resolves `false` on any failure.
4. In the provider registry, add a setup routine for the name. It throws when required config is missing, loads the SDK with a dynamic import, throws an install hint when that import fails and builds the client once.
5. Export the config type from the package entry point. Keep the adapter factory internal, because callers reach providers through `createProvider` and `createEmailManager`.
6. Add a test suite for the adapter modeled on the Resend one. Cover payload mapping, error mapping, validation, `validateConfig` and the registry's setup errors.
7. Add `docs/providers/NAME.md` describing how messages and errors cross that provider's boundary.

## Other extensions

- **Add a message field to both `TemplatedEmailMessage` and `EmailMessage`, copy it in the manager and map it in every adapter.** The manager builds the outgoing message explicitly, so each layer must carry the field on.
- **Add a render option to `TemplateRenderOptions` and give it a default in the template renderer.** The defaults object is typed as the required form of the options, so type-check fails until the default exists.
- **Add an error code to `EmailErrorCode` and produce it from an adapter's rules or the shared validation.** Consumers may switch on that public union exhaustively, so a new member can break their build.
- **Re-export every new public function or type from the package entry point and show it in the README or a docs page.** Anything not exported there does not exist for consumers.

## Tests

- **Put tests in `__tests__`, one suite per part.** Vitest would also collect tests beside the source, but the package keeps them apart.
- **Mock external modules at their boundary with `vi.mock`. Mock the SDK for an adapter, `@react-email/render` for the renderer, and the registry and renderer for the manager.** Each suite then checks one part's own logic and no test touches the network.
- **Use the spy and no-op loggers from `@nextnode-solutions/logger/testing`.** They let a test assert what was logged without printing anything.

## Checks

Run from the repository root:

```bash
pnpm turbo run build --filter='@nextnode-solutions/email-manager^...'
pnpm --filter @nextnode-solutions/email-manager type-check
pnpm --filter @nextnode-solutions/email-manager lint
pnpm --filter @nextnode-solutions/email-manager test
pnpm --filter @nextnode-solutions/email-manager format:check
```

The first command builds the workspace packages this one depends on.
