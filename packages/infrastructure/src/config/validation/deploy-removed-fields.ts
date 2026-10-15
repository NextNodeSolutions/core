// Secrets are no longer declared: every Worker receives the whole Infisical
// environment of the project named after the repository. A leftover list is
// rejected rather than ignored, so it cannot be mistaken for a filter.
export const REMOVED_SECRETS_FIELD_REASON =
	'secrets are not declared in nextnode.toml - every Worker receives the secrets of the Infisical project named after the repository'
