import { computeSiteUrl } from './domain.ts'
import { redirectZoneLabel, toTerraformLabel } from './terraform-labels.ts'

import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	DnsRecordResource,
	RulesetResource,
} from './terraform-main-config.ts'

// Support A record content for a redirect zone: an unroutable TEST-NET-1 address
// (RFC 5737). The record exists ONLY to be orange-clouded so the Redirect Rule
// runs at Cloudflare's edge before any origin is contacted - the IP is never
// reached.
const REDIRECT_PLACEHOLDER_IP = '192.0.2.1'

// TTL sentinel meaning "automatic" for a proxied Cloudflare DNS record.
const DNS_TTL_AUTOMATIC = 1

const REDIRECT_STATUS_CODE = 301

export interface RedirectResources {
	readonly dns: Record<string, DnsRecordResource>
	readonly rulesets: Record<string, RulesetResource>
}

function redirectDnsRecord(
	redirectDomain: string,
	name: string,
): DnsRecordResource {
	return {
		zone_id: `\${data.cloudflare_zone.${redirectZoneLabel(redirectDomain)}.id}`,
		name,
		type: 'A',
		content: REDIRECT_PLACEHOLDER_IP,
		ttl: DNS_TTL_AUTOMATIC,
		proxied: true,
	}
}

function redirectRuleset(
	redirectDomain: string,
	siteUrl: string,
	resolvedDomain: string,
): RulesetResource {
	const label = toTerraformLabel(redirectDomain)
	return {
		zone_id: `\${data.cloudflare_zone.${redirectZoneLabel(redirectDomain)}.id}`,
		name: `redirect-${label}-to-main`,
		kind: 'root',
		phase: 'http_request_dynamic_redirect',
		rules: [
			{
				ref: `redirect_${label}`,
				description: `Redirect ${redirectDomain} and www.${redirectDomain} to ${resolvedDomain}`,
				expression: `(http.host eq "${redirectDomain}" or http.host eq "www.${redirectDomain}")`,
				action: 'redirect',
				action_parameters: {
					from_value: {
						target_url: {
							expression: `concat("${siteUrl}", http.request.uri.path)`,
						},
						preserve_query_string: true,
						status_code: REDIRECT_STATUS_CODE,
					},
				},
			},
		],
	}
}

export function buildRedirectResources(
	domain: string,
	environment: AppEnvironment,
	resolvedDomain: string,
	redirectDomains: ReadonlyArray<string>,
): RedirectResources {
	const siteUrl = computeSiteUrl(domain, environment)
	const dns: Record<string, DnsRecordResource> = {}
	const rulesets: Record<string, RulesetResource> = {}
	for (const redirectDomain of redirectDomains) {
		const label = toTerraformLabel(redirectDomain)
		dns[`redirect_${label}_apex`] = redirectDnsRecord(
			redirectDomain,
			redirectDomain,
		)
		dns[`redirect_${label}_www`] = redirectDnsRecord(
			redirectDomain,
			`www.${redirectDomain}`,
		)
		rulesets[`redirect_${label}`] = redirectRuleset(
			redirectDomain,
			siteUrl,
			resolvedDomain,
		)
	}
	return { dns, rulesets }
}
