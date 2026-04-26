export const parseFiniteNumber = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null

export const requireFiniteNumber = (
	value: unknown,
	field: string,
	context: string,
): number => {
	const parsed = parseFiniteNumber(value)
	if (parsed === null) throw new Error(`${context}: missing \`${field}\``)
	return parsed
}
