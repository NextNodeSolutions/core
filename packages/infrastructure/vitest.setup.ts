// Hermetic env baseline for the infrastructure CLI test suite.
//
// Every input to this CLI arrives through process.env (tokens, account ids,
// pipeline config). CI runs each job with a clean environment, so a test
// asserting `requireEnv('CLOUDFLARE_API_TOKEN')` throws when the var is unset
// passes there. A developer machine is different: the shell frequently exports
// the very same credentials, and vitest workers inherit process.env, so those
// leaked values turn the "throws when X is missing" tests into false negatives
// (here, outright failures because the expected throw never happens).
//
// Strip the entire env surface the CLI reads before any test runs, so the suite
// starts from the same empty baseline as CI regardless of the developer's
// shell. Tests that need a value set it explicitly via vi.stubEnv(); nothing
// depends on an inherited value (every referenced var is stubbed at its use
// site). Keep this list in sync with the env vars read across cli/ via
// requireEnv / getEnv / isEnvSet / requireB64Env / readJsonRecordEnv / getEnumEnv.
const CLI_ENV_VARS = [
	'ALL_SECRETS',
	'ALL_VARS',
	'BUILD_DIRECTORY',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_API_TOKEN',
	'DEPLOY_SSH_PRIVATE_KEY_B64',
	'DEV_WORKFLOW_FILE',
	'GH_TOKEN',
	'GHCR_TOKEN',
	'GITHUB_EVENT_NAME',
	'GITHUB_REPOSITORY',
	'GITHUB_REPOSITORY_OWNER',
	'GITHUB_SHA',
	'GITHUB_WORKSPACE',
	'HETZNER_API_TOKEN',
	'IMAGE_REFS',
	'NN_CLIENT_ID',
	'NN_VL_URL',
	'PACKAGE_DIR',
	'PIPELINE_BASE_SHA',
	'PIPELINE_CONFIG_FILE',
	'PIPELINE_ENVIRONMENT',
	'PROJECT_FILTER',
	'PUBLISH_BRANCH',
	'R2_ACCESS_KEY_ID',
	'R2_SECRET_ACCESS_KEY',
	'RECOVER_VPS_NAMES',
	'SR_OUTPUT_FILE',
	'TAILSCALE_AUTH_KEY',
	'TEARDOWN_CONFIRM',
	'TEARDOWN_SKIP_FINAL_BACKUP',
	'TEARDOWN_TARGET',
	'TEARDOWN_WIPE_BACKUPS',
	'TEARDOWN_WIPE_DATA',
	'TEARDOWN_WITH_VOLUMES',
	'TF_TOKEN_app_terraform_io',
] as const

for (const name of CLI_ENV_VARS) {
	Reflect.deleteProperty(process.env, name)
}
