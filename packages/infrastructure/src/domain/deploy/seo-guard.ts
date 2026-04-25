import type { AppEnvironment } from '@/domain/environment.ts'

export interface GuardFile {
	readonly filename: string
	readonly content: string
}

export function computeSeoGuardFiles(
	environment: AppEnvironment,
): ReadonlyArray<GuardFile> {
	if (environment === 'production') return []

	return [
		{
			filename: '_headers',
			content: '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n',
		},
		{
			filename: 'robots.txt',
			content: 'User-agent: *\nDisallow: /\n',
		},
	]
}
