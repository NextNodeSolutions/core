// Terraform resource/data labels are the identity of the state entry - renaming
// one is a destroy/recreate. They must be deterministic: a kebab alias or a
// dotted domain maps to a stable snake-case label.
export function toTerraformLabel(rawLabel: string): string {
	return rawLabel.toLowerCase().replaceAll('.', '_').replaceAll('-', '_')
}

export function redirectZoneLabel(redirectDomain: string): string {
	return `zone_redirect_${toTerraformLabel(redirectDomain)}`
}

// Both a resource key and an interpolation target (`bucket_name`, the
// `r2_buckets` output): two spellings would emit a reference to no resource.
export function r2BucketLabel(bucketName: string): string {
	return `r2_${toTerraformLabel(bucketName)}`
}

export function indexBy<T>(
	names: ReadonlyArray<string>,
	entry: (name: string) => readonly [string, T],
): Record<string, T> {
	const map: Record<string, T> = {}
	for (const name of names) {
		const [key, value] = entry(name)
		map[key] = value
	}
	return map
}
