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

/**
 * Derive the logical identity of a Cloudflare Pages project from its name.
 *
 * NextNode pairs each app with a `{name}-dev` project for the development
 * environment. This helper splits a raw Pages project name into the logical
 * base name plus the matching environment label.
 */
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
