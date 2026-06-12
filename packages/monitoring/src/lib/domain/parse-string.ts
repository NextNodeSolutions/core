export const parseStringOrNull = (candidate: unknown): string | null =>
	typeof candidate === 'string' && candidate.length > 0 ? candidate : null

export const parseStringArray = (candidate: unknown): ReadonlyArray<string> => {
	if (!Array.isArray(candidate)) return []
	return candidate.filter(
		(entry): entry is string => typeof entry === 'string',
	)
}
