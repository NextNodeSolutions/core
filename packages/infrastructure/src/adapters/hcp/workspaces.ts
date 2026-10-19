import { fetchBounded } from '#/adapters/http/fetch.ts'
import {
	EXECUTION_MODE_LOCAL,
	assertLocalExecutionMode,
} from '#/domain/cloudflare/workers/hcp-workspace.ts'
import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'
import { createLogger } from '@nextnode-solutions/logger'
import { object, safeParse, string } from 'valibot'

import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'

const logger = createLogger()

const TERRAFORM_CLOUD_API_BASE = 'https://app.terraform.io/api/v2'

const HCP_CONTENT_TYPE = 'application/vnd.api+json'

export interface EnsureHcpWorkspaceInput {
	readonly organization: string
	readonly workspaceName: string
	readonly token: string
}

function hcpHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': HCP_CONTENT_TYPE,
	}
}

const WORKSPACE_RESPONSE_SCHEMA = object(
	{
		data: object(
			{
				attributes: object(
					{
						'execution-mode': string(
							'`execution-mode` is not a string',
						),
					},
					'response missing `execution-mode`',
				),
			},
			'response `data` missing `attributes`',
		),
	},
	'response missing `data`',
)

function readExecutionMode(responseBody: unknown, context: string): string {
	const workspace = safeParse(WORKSPACE_RESPONSE_SCHEMA, responseBody, {
		abortEarly: true,
	})
	if (!workspace.success) {
		throw new Error(`${context}: ${workspace.issues[0].message}`)
	}
	return workspace.output.data.attributes['execution-mode']
}

async function createHcpWorkspace(
	organization: string,
	workspaceName: string,
	token: string,
): Promise<ResourceOutcome> {
	logger.info(`Creating HCP Terraform workspace "${workspaceName}"`)
	const createResponse = await fetchBounded(
		`${TERRAFORM_CLOUD_API_BASE}/organizations/${organization}/workspaces`,
		{
			operation: `HCP Terraform API: create workspace "${workspaceName}"`,
			method: 'POST',
			headers: hcpHeaders(token),
			body: JSON.stringify({
				data: {
					type: 'workspaces',
					attributes: {
						name: workspaceName,
						'execution-mode': EXECUTION_MODE_LOCAL,
					},
				},
			}),
		},
	)

	if (!createResponse.ok) {
		throw new Error(
			`HCP Terraform API returned ${String(createResponse.status)}: ${createResponse.body}`,
		)
	}

	logger.info(
		`HCP Terraform workspace "${workspaceName}" created (execution mode ${EXECUTION_MODE_LOCAL})`,
	)
	return {
		handled: true,
		detail: `created "${workspaceName}" (execution mode ${EXECUTION_MODE_LOCAL})`,
	}
}

/**
 * Ensure the HCP Terraform workspace backing this deploy exists (create-if-
 * absent). Probes via GET (404 is the valid "not found" state, so the raw
 * fetch is not routed through a throw-on-non-ok helper), creates it in local
 * execution mode otherwise. An existing workspace is asserted to be local -
 * a remote workspace would run Terraform on HCP instead of in CI, which the
 * state-only design forbids.
 */
export async function ensureHcpWorkspace(
	input: EnsureHcpWorkspaceInput,
): Promise<ResourceOutcome> {
	const { organization, workspaceName, token } = input
	const context = `HCP Terraform workspace "${workspaceName}"`
	const getResponse = await fetchBounded(
		`${TERRAFORM_CLOUD_API_BASE}/organizations/${organization}/workspaces/${workspaceName}`,
		{
			operation: `HCP Terraform API: read workspace "${workspaceName}"`,
			headers: hcpHeaders(token),
		},
	)

	if (getResponse.ok) {
		const responseBody = parseJsonOrThrow(getResponse.body, context)
		assertLocalExecutionMode(
			readExecutionMode(responseBody, context),
			workspaceName,
		)
		logger.info(`${context} already exists`)
		return { handled: false, detail: `existing "${workspaceName}"` }
	}

	if (getResponse.status !== HTTP_NOT_FOUND) {
		throw new Error(
			`HCP Terraform API returned ${String(getResponse.status)}: ${getResponse.body}`,
		)
	}

	return createHcpWorkspace(organization, workspaceName, token)
}
