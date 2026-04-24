import { logger } from '@/lib/adapters/logger.ts'

const PROBE_TIMEOUT_MS = 3000

// `redirect: 'manual'` is load-bearing: distinguishing 200 from 302 is the
// whole point of the probe — see `selectPrimaryDomain`. Returns `null` on
// timeout / network error so a single broken domain cannot take down the
// listing page.
export const probeDomainStatus = async (
	hostname: string,
): Promise<number | null> => {
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
