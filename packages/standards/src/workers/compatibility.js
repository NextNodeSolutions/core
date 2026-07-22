/**
 * The Cloudflare Workers runtime version the whole fleet pins for local
 * `wrangler dev`. It MUST equal the deploy-time pin in
 * `@nextnode-solutions/infrastructure`
 * (`DEFAULT_WORKERS_COMPATIBILITY_DATE`), so local behaviour matches prod; a
 * drift test in that package fails the monorepo build if the two ever diverge.
 * Bumping it is a deliberate, reviewed fleet change - pair it with
 * `pnpm update wrangler` so every workerd is new enough to honour the date.
 */
export const WORKERS_COMPATIBILITY_DATE = '2026-07-14'

export const WORKERS_COMPATIBILITY_FLAGS = ['nodejs_compat']

const WORKERD_VERSION_PATTERN = /^\d+\.(\d{4})(\d{2})(\d{2})\.\d+$/

export const parseWorkerdCompatibilityDate = version => {
	const match = WORKERD_VERSION_PATTERN.exec(version)
	if (!match) {
		throw new Error(
			`Unrecognized workerd version "${version}": expected "1.YYYYMMDD.patch".`,
		)
	}
	const [, year, month, day] = match
	return `${year}-${month}-${day}`
}

export const isRuntimeCompatible = (workerdDate, requiredDate) =>
	workerdDate >= requiredDate

export const buildWranglerDevArgs = (passthrough, date, flags) => {
	const args = ['dev', ...passthrough, '--compatibility-date', date]
	if (flags.length > 0) {
		args.push('--compatibility-flags', ...flags)
	}
	return args
}
