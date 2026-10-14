import type { DeploySection } from '#/config/types.ts'

// The declared secrets that must ALREADY exist in the vault when the pipeline
// starts. Auto-generated entries are excluded: `ensureGeneratedSecrets` creates
// and stores them at provision, so their absence from a pre-provision snapshot
// is the expected first-run state, not a config bug.
export function collectRequiredSecrets(
	deploy: DeploySection,
): ReadonlyArray<string> {
	const generated = new Set(deploy.generatedSecrets.map(spec => spec.name))
	return deploy.secrets.filter(name => !generated.has(name))
}

export function findMissingSecrets(
	required: ReadonlyArray<string>,
	available: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
	return required.filter(name => !(name in available))
}

export function formatMissingSecretsError(
	missing: ReadonlyArray<string>,
	vaultPath: string,
): string {
	return `${missing.length} secret(s) declared in nextnode.toml are absent from the vault folder "${vaultPath}": ${missing.join(', ')}\n\nAdd them to that folder, then re-run the pipeline.`
}
