import { stringify } from 'yaml'

/**
 * blackbox_exporter modules. A single `http_2xx` module for now: HTTPS
 * GET from nn-internals, following redirects, requiring a 2xx. TLS
 * verification stays on - an invalid chain must fail the probe (that IS
 * the signal CertExpirySoon refines).
 */
export function renderBlackboxConfig(): string {
	const config = {
		modules: {
			http_2xx: {
				prober: 'http',
				timeout: '10s',
				http: {
					method: 'GET',
					follow_redirects: true,
					preferred_ip_protocol: 'ip4',
					fail_if_not_ssl: true,
				},
			},
		},
	}
	return stringify(config, { lineWidth: 0 })
}
