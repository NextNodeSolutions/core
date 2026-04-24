export const parseStringUnion = <T extends string>(
	value: unknown,
	allowed: ReadonlyArray<T>,
	fallback: T,
): T => {
	if (typeof value !== 'string') return fallback
	for (const candidate of allowed) {
		if (candidate === value) return candidate
	}
	return fallback
}
