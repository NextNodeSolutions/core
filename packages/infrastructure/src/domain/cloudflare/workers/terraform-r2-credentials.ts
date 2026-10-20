import { r2BucketLabel } from './terraform-labels.ts'
import { ACCOUNT_ID_REF } from './terraform-refs.ts'

import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	ApiTokenResource,
	OutputValue,
	PermissionGroupsDataSource,
} from './terraform-main-config.ts'
import type { WorkersDerivedResources } from './terraform-resources.ts'

// A container reaches R2 through its S3 API, which signs requests with an
// access key pair derived from a Cloudflare API token: the token id is the
// access key id, the SHA-256 hex of its value the secret access key. Terraform
// creates one such token per project and environment, scoped to the project's
// buckets with object read and write, and destroys it on teardown. The CI
// token therefore needs User > API Tokens: Edit.
const R2_S3_TOKEN_LABEL = 'r2_s3'
const R2_S3_TOKEN_REF = `cloudflare_api_token.${R2_S3_TOKEN_LABEL}`

export interface R2S3Credentials {
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

export const R2_S3_ACCESS_KEY_ID_OUTPUT = 'r2_s3_access_key_id'
export const R2_S3_SECRET_ACCESS_KEY_OUTPUT = 'r2_s3_secret_access_key'

// The permission groups of the dashboard's "Object Read & Write" R2 token, by
// data source label. Their ids are looked up by name, never hardcoded.
const R2_OBJECT_PERMISSION_GROUPS = {
	r2_object_read: 'Workers R2 Storage Bucket Item Read',
	r2_object_write: 'Workers R2 Storage Bucket Item Write',
} as const

const PERMISSION_GROUPS_DATA_SOURCE =
	'cloudflare_api_token_permission_groups_list'

function computeR2S3TokenName(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `${projectName}-${environment}-r2-s3`
}

export function buildR2PermissionGroupData(): Record<
	string,
	PermissionGroupsDataSource
> {
	return Object.fromEntries(
		Object.entries(R2_OBJECT_PERMISSION_GROUPS).map(([label, name]) => [
			label,
			{ name: encodeURIComponent(name) },
		]),
	)
}

// The name filter of the data source is a search, so the id is the one exact
// match: `one()` fails the plan on several, and a missing group leaves the
// required id null, which fails it too.
function permissionGroupIdRef(label: string, name: string): string {
	return `\${one([for group in data.${PERMISSION_GROUPS_DATA_SOURCE}.${label}.result : group.id if group.name == "${name}"])}`
}

// The IAM resource key of a bucket. Interpolating the bucket resource both
// keeps its jurisdiction exact and orders the token after the bucket.
function bucketResourceKey(bucketName: string): string {
	const bucket = `cloudflare_r2_bucket.${r2BucketLabel(bucketName)}`
	return `com.cloudflare.edge.r2.bucket.${ACCOUNT_ID_REF}_\${${bucket}.jurisdiction}_\${${bucket}.name}`
}

export function buildR2S3Token(
	derived: WorkersDerivedResources,
): Record<string, ApiTokenResource> {
	return {
		[R2_S3_TOKEN_LABEL]: {
			name: computeR2S3TokenName(
				derived.projectName,
				derived.environment,
			),
			policies: [
				{
					effect: 'allow',
					permission_groups: Object.entries(
						R2_OBJECT_PERMISSION_GROUPS,
					).map(([label, name]) => ({
						id: permissionGroupIdRef(label, name),
					})),
					// A JSON document as a string, as the provider takes it.
					resources: JSON.stringify(
						Object.fromEntries(
							derived.buckets.map(bucket => [
								bucketResourceKey(bucket.name),
								'*',
							]),
						),
					),
				},
			],
		},
	}
}

// Both sensitive: the id is half of the key pair.
export function buildR2S3Outputs(): Record<string, OutputValue> {
	return {
		[R2_S3_ACCESS_KEY_ID_OUTPUT]: {
			value: `\${${R2_S3_TOKEN_REF}.id}`,
			sensitive: true,
		},
		[R2_S3_SECRET_ACCESS_KEY_OUTPUT]: {
			value: `\${sha256(${R2_S3_TOKEN_REF}.value)}`,
			sensitive: true,
		},
	}
}
