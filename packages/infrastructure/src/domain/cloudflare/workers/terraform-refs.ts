// account_id is injected at apply time as TF_VAR_account_id (the adapter knows
// the account id from the env; the pure config never does), so every
// account-scoped resource references this Terraform variable rather than a
// literal. Shared by the resource builders (core + PlanetScale).
export const ACCOUNT_ID_REF = '${var.account_id}'
