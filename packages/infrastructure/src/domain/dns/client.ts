import type {
	DesiredDnsRecord,
	DnsRecordLookup,
} from '@/domain/cloudflare/dns-records.ts'

/**
 * Provider-agnostic DNS contract. Adapters that need DNS reconciliation
 * (Hetzner, future AWS, …) consume this through the cli-layer factory
 * instead of reaching across to the Cloudflare DNS adapter directly —
 * cross-adapter calls are forbidden by the layered architecture.
 *
 * Cloudflare is the only DNS provider today; adding another provider
 * means a second implementation of this contract plus a switch in the
 * cli factory.
 */
export interface DnsClient {
	reconcile(records: ReadonlyArray<DesiredDnsRecord>): Promise<void>
	deleteByName(lookups: ReadonlyArray<DnsRecordLookup>): Promise<number>
}
