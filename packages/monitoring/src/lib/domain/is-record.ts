export const isRecord = (
	candidate: unknown,
): candidate is Record<string, unknown> =>
	typeof candidate === 'object' &&
	candidate !== null &&
	!Array.isArray(candidate)
