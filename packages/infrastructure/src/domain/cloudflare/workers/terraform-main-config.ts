interface TerraformCloudBlock {
	readonly organization: string
	readonly workspaces: { readonly name: string }
}

interface RequiredProvider {
	readonly source: string
	readonly version: string
}

interface TerraformBlock {
	readonly cloud: TerraformCloudBlock
	readonly required_providers: { readonly cloudflare: RequiredProvider }
}

interface ProviderBlock {
	readonly cloudflare: Record<string, never>
}

interface VariableDeclaration {
	readonly type: string
}

export interface ZoneDataSource {
	readonly filter: { readonly name: string }
}

export interface D1DatabaseResource {
	readonly account_id: string
	readonly name: string
}

export interface KvNamespaceResource {
	readonly account_id: string
	readonly title: string
}

export interface QueueResource {
	readonly account_id: string
	readonly queue_name: string
}

export interface R2BucketResource {
	readonly account_id: string
	readonly name: string
	readonly location: string
}

export interface R2CustomDomainResource {
	readonly account_id: string
	readonly bucket_name: string
	readonly domain: string
	readonly zone_id: string
	readonly enabled: boolean
}

export interface DnsRecordResource {
	readonly zone_id: string
	readonly name: string
	readonly type: 'A'
	readonly content: string
	readonly ttl: number
	readonly proxied: boolean
}

export interface RulesetRule {
	readonly ref: string
	readonly description: string
	readonly expression: string
	readonly action: 'redirect'
	readonly action_parameters: {
		readonly from_value: {
			readonly target_url: { readonly expression: string }
			readonly preserve_query_string: boolean
			readonly status_code: number
		}
	}
}

export interface RulesetResource {
	readonly zone_id: string
	readonly name: string
	readonly kind: 'root'
	readonly phase: 'http_request_dynamic_redirect'
	readonly rules: ReadonlyArray<RulesetRule>
}

export interface TerraformResourceBlock {
	readonly cloudflare_d1_database?: Readonly<
		Record<string, D1DatabaseResource>
	>
	readonly cloudflare_workers_kv_namespace?: Readonly<
		Record<string, KvNamespaceResource>
	>
	readonly cloudflare_queue?: Readonly<Record<string, QueueResource>>
	readonly cloudflare_r2_bucket?: Readonly<Record<string, R2BucketResource>>
	readonly cloudflare_r2_custom_domain?: Readonly<
		Record<string, R2CustomDomainResource>
	>
	readonly cloudflare_dns_record?: Readonly<Record<string, DnsRecordResource>>
	readonly cloudflare_ruleset?: Readonly<Record<string, RulesetResource>>
}

export type TerraformResourceDraft = {
	-readonly [K in keyof TerraformResourceBlock]?: TerraformResourceBlock[K]
}

export interface OutputValue {
	readonly value: string | Readonly<Record<string, string>>
}

export interface TerraformMainConfig {
	readonly terraform: TerraformBlock
	readonly provider: ProviderBlock
	readonly variable?: { readonly account_id: VariableDeclaration }
	readonly data: {
		readonly cloudflare_zone: Readonly<Record<string, ZoneDataSource>>
	}
	readonly resource?: TerraformResourceBlock
	readonly output?: Readonly<Record<string, OutputValue>>
}
