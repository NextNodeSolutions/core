// account_id is injected at apply time as TF_VAR_account_id (the adapter knows
// the account id from the env; the pure config never does), so every
// account-scoped resource references this Terraform variable rather than a
// literal. Shared by the resource builders (core + PlanetScale).
export const ACCOUNT_ID_REF = '${var.account_id}'

// The project's own zone: always a `data` lookup (never a managed resource) and
// always present, so every zone-scoped rule family interpolates this reference
// rather than rebuilding the label.
export const MAIN_ZONE_LABEL = 'zone_main'
export const MAIN_ZONE_ID_REF = `\${data.cloudflare_zone.${MAIN_ZONE_LABEL}.id}`
