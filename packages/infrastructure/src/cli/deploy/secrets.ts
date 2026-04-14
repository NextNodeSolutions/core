function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false
	}
	return Object.values(value).every(v => typeof v === 'string')
}

export function parseAllSecrets(raw: string): Record<string, string> {
	const parsed: unknown = JSON.parse(raw)
	if (!isStringRecord(parsed)) {
		throw new Error('ALL_SECRETS must be a JSON object with string values')
	}
	return parsed
}

export function pickSecrets(
	allSecrets: Readonly<Record<string, string>>,
	names: ReadonlyArray<string>,
): Record<string, string> {
	const picked: Record<string, string> = {}

	for (const name of names) {
		const value = allSecrets[name]
		if (value === undefined) {
			throw new Error(
				`Secret "${name}" declared in deploy.secrets but not found in GitHub Secrets`,
			)
		}
		picked[name] = value
	}

	return picked
}
