import {
	EXECUTION_MODE_LOCAL,
	assertLocalExecutionMode,
} from '#/domain/cloudflare/workers/hcp-workspace.ts'
import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'

const logger = createLogger()

export const TERRAFORM_CLOUD_API_BASE = 'https://app.terraform.io/api/v2'

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

function readExecutionMode(responseBody: unknown, context: string): string {
	if (
		typeof responseBody !== 'object' ||
		responseBody === null ||
		!('data' in responseBody)
	) {
		throw new Error(`${context}: response missing \`data\``)
	}
	const { data } = responseBody
	if (typeof data !== 'object' || data === null || !('attributes' in data)) {
		throw new Error(`${context}: response \`data\` missing \`attributes\``)
	}
	const { attributes } = data
	if (
		typeof attributes !== 'object' ||
		attributes === null ||
		!('execution-mode' in attributes)
	) {
		throw new Error(`${context}: response missing \`execution-mode\``)
	}
	const mode = attributes['execution-mode']
	if (typeof mode !== 'string') {
		throw new Error(`${context}: \`execution-mode\` is not a string`)
	}
	return mode
}

async function createHcpWorkspace(
	organization: string,
	workspaceName: string,
	token: string,
): Promise<ResourceOutcome> {
	logger.info(`Creating HCP Terraform workspace "${workspaceName}"`)
	const createResponse = await fetch(
		`${TERRAFORM_CLOUD_API_BASE}/organizations/${organization}/workspaces`,
		{
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
		const body = await createResponse.text()
		throw new Error(
			`HCP Terraform API returned ${String(createResponse.status)}: ${body}`,
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
	const getResponse = await fetch(
		`${TERRAFORM_CLOUD_API_BASE}/organizations/${organization}/workspaces/${workspaceName}`,
		{ headers: hcpHeaders(token) },
	)

	if (getResponse.ok) {
		const responseBody: unknown = await getResponse.json()
		assertLocalExecutionMode(
			readExecutionMode(responseBody, context),
			workspaceName,
		)
		logger.info(`${context} already exists`)
		return { handled: false, detail: `existing "${workspaceName}"` }
	}

	if (getResponse.status !== HTTP_NOT_FOUND) {
		const body = await getResponse.text()
		throw new Error(
			`HCP Terraform API returned ${String(getResponse.status)}: ${body}`,
		)
	}

	return createHcpWorkspace(organization, workspaceName, token)
}
