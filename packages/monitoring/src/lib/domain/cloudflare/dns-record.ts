import { parseStringUnion } from '@/lib/domain/parse-string-union.ts'

export const DNS_RECORD_TYPES = [
	'A',
	'AAAA',
	'CNAME',
	'TXT',
	'MX',
	'SRV',
	'NS',
	'CAA',
	'PTR',
	'unknown',
] as const

export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number]

export interface CloudflareDnsRecord {
	readonly id: string
	readonly zoneId: string
	readonly zoneName: string
	readonly name: string
	readonly type: DnsRecordType
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
	readonly comment: string | null
}

export const parseDnsRecordType = (value: unknown): DnsRecordType =>
	parseStringUnion(value, DNS_RECORD_TYPES, 'unknown')
