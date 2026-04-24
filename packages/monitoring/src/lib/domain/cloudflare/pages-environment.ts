export type CloudflarePagesEnvironment = 'production' | 'development'

export interface CloudflarePagesProjectIdentity {
	readonly baseName: string
	readonly environment: CloudflarePagesEnvironment
}

const DEV_SUFFIX = '-dev'

export const isDevProjectName = (name: string): boolean =>
	name.endsWith(DEV_SUFFIX)

export const stripDevSuffix = (name: string): string =>
	name.slice(0, -DEV_SUFFIX.length)

// NextNode pairs each app with a `{name}-dev` project for the development
// environment; this helper inverts that convention.
export const resolveProjectIdentity = (
	name: string,
): CloudflarePagesProjectIdentity => {
	if (isDevProjectName(name)) {
		return { baseName: stripDevSuffix(name), environment: 'development' }
	}
	return { baseName: name, environment: 'production' }
}

export const toSiblingProjectName = (
	name: string,
	target: CloudflarePagesEnvironment,
): string => {
	const { baseName } = resolveProjectIdentity(name)
	return target === 'development' ? `${baseName}${DEV_SUFFIX}` : baseName
}

export const environmentLabel = (
	environment: CloudflarePagesEnvironment,
): string => (environment === 'production' ? 'Production' : 'Development')
