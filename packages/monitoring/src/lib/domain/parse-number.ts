export const parseFiniteNumber = (candidate: unknown): number | null =>
	typeof candidate === 'number' && Number.isFinite(candidate)
		? candidate
		: null

export const requireFiniteNumber = (
	candidate: unknown,
	field: string,
	context: string,
): number => {
	const parsed = parseFiniteNumber(candidate)
	if (parsed === null) throw new Error(`${context}: missing \`${field}\``)
	return parsed
}
