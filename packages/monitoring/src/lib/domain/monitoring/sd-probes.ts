import type { SdTargetGroup } from '@/lib/domain/monitoring/sd-targets.ts'

/**
 * A VPS's publicly-routed domains, resolved by the adapter layer from
 * the Cloudflare DNS records pointing at its public IP.
 */
export interface ProbeSource {
	readonly hostname: string
	readonly ownerProject: string | null
	readonly domains: ReadonlyArray<string>
}

/**
 * Build the http_sd response for /api/sd/probes: one HTTPS URL target
 * per public domain of every client VPS. blackbox_exporter receives the
 * URL through the standard `__param_target` indirection wired in the
 * vmagent blackbox job.
 */
export const buildSdProbes = (
	sources: ReadonlyArray<ProbeSource>,
): ReadonlyArray<SdTargetGroup> =>
	sources.flatMap(source =>
		source.domains.map(domain => ({
			targets: [`https://${domain}`],
			labels: {
				__meta_tailscale_device_hostname: source.hostname,
				...(source.ownerProject !== null && {
					__meta_nextnode_project: source.ownerProject,
				}),
			},
		})),
	)
