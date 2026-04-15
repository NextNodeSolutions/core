import { bucketResourceKey } from './addressing.ts'

export interface R2PermissionGroupIds {
	readonly readId: string
	readonly writeId: string
}

export interface R2TokenPolicyInput {
	readonly tokenName: string
	readonly accountId: string
	readonly bucketNames: ReadonlyArray<string>
	readonly permissions: R2PermissionGroupIds
}

interface R2TokenPolicyBody {
	readonly name: string
	readonly policies: ReadonlyArray<{
		readonly effect: 'allow'
		readonly permission_groups: ReadonlyArray<{ readonly id: string }>
		readonly resources: Record<string, '*'>
	}>
}

/**
 * Build the request body for `POST /user/tokens` that creates an R2 API
 * token scoped to one or more buckets. The resulting token carries both
 * read and write permissions on every listed bucket.
 */
export function buildR2TokenPolicy(
	input: R2TokenPolicyInput,
): R2TokenPolicyBody {
	if (input.bucketNames.length === 0) {
		throw new Error('buildR2TokenPolicy: bucketNames must not be empty')
	}

	const resources: Record<string, '*'> = {}
	for (const bucket of input.bucketNames) {
		resources[bucketResourceKey(input.accountId, bucket)] = '*'
	}

	return {
		name: input.tokenName,
		policies: [
			{
				effect: 'allow',
				permission_groups: [
					{ id: input.permissions.readId },
					{ id: input.permissions.writeId },
				],
				resources,
			},
		],
	}
}
