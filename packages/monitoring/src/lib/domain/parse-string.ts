export const parseStringOrNull = (candidate: unknown): string | null =>
	typeof candidate === 'string' && candidate.length > 0 ? candidate : null

export const parseStringArray = (candidate: unknown): ReadonlyArray<string> => {
	if (!Array.isArray(candidate)) return []
	return candidate.filter(
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- Array.isArray narrows untrusted input to any[]; the predicate validates its elements
		(entry): entry is string => typeof entry === 'string',
	)
}
