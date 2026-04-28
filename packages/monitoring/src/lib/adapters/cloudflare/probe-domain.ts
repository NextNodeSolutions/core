import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { logger } from '@/lib/adapters/logger.ts'

const PROBE_TIMEOUT_MS = 3000

// Domain reachability rarely flips inside 5 min, and the probe itself is the
// single biggest perf offender on the dashboard (a slow custom domain spends
// the full timeout per page render). Cache aggressively; manual reload past
// the TTL is acceptable for an internal dashboard.
const PROBE_TTL_MS = 300_000

// `redirect: 'manual'` is load-bearing: distinguishing 200 from 302 is the
// whole point of the probe — see `selectPrimaryDomain`. Returns `null` on
// timeout / network error so a single broken domain cannot take down the
// listing page.
const runProbe = async (hostname: string): Promise<number | null> => {
	const controller = new AbortController()
	const timer = setTimeout(() => {
		controller.abort()
	}, PROBE_TIMEOUT_MS)
	try {
		const response = await fetch(`https://${hostname}`, {
			method: 'HEAD',
			redirect: 'manual',
			signal: controller.signal,
		})
		return response.status
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.debug('cloudflare.probe-domain: probe failed', {
			hostname,
			message,
		})
		return null
	} finally {
		clearTimeout(timer)
	}
}

const memoizedProbe = keyedMemoizeAsync(
	PROBE_TTL_MS,
	(hostname: string) => hostname,
	runProbe,
)

export const probeDomainStatus = (hostname: string): Promise<number | null> =>
	memoizedProbe(hostname)
