// oxlint-disable-next-line nextnode/no-generic-runtime-guard -- canonical low-level guard shared by schema-free monitoring adapters
export const isRecord = (
	candidate: unknown,
): candidate is Record<string, unknown> =>
	typeof candidate === 'object' &&
	candidate !== null &&
	!Array.isArray(candidate)
