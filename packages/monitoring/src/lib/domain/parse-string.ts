export const parseStringOrNull = (value: unknown): string | null =>
	typeof value === 'string' && value.length > 0 ? value : null

export const parseStringArray = (value: unknown): ReadonlyArray<string> => {
	if (!Array.isArray(value)) return []
	return value.filter((entry): entry is string => typeof entry === 'string')
}
