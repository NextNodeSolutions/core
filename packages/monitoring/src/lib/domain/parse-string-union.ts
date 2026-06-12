export const parseStringUnion = <T extends string>(
	candidate: unknown,
	allowed: ReadonlyArray<T>,
	fallback: T,
): T => {
	if (typeof candidate !== 'string') return fallback
	for (const allowedValue of allowed) {
		if (allowedValue === candidate) return allowedValue
	}
	return fallback
}
