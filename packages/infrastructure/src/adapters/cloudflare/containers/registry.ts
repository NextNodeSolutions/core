import {
	CLOUDFLARE_CONTAINER_REGISTRY,
	IMAGE_TAG_PATTERN,
} from '#/domain/cloudflare/workers/container-image.ts'
import { createLogger } from '@nextnode-solutions/logger'
import { array, object, optional, record, safeParse, string } from 'valibot'

import { cloudflareRequest, fetchWithRetry, readResult } from '../api.ts'

import type { CloudflareApiAccess } from '../api.ts'

const logger = createLogger()

// Long enough for a push and the prune that follows a deploy; a teardown
// finishes well within it.
const CREDENTIALS_EXPIRATION_MINUTES = 15
const REGISTRY_BASE = `https://${CLOUDFLARE_CONTAINER_REGISTRY}`
// Both manifest formats the registry stores; a tag answers with its own.
const MANIFEST_ACCEPT =
	'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
const HTTP_NOT_FOUND = 404
// The user the registry's HTTP API authenticates minted credentials as;
// `docker login` takes the `username` the API returns instead.
const REGISTRY_API_USER = 'v1'
const LEADING_SLASHES = /^\/+/u

const credentialsSchema = object({ username: string(), password: string() })

// `GET /v2/_catalog?tags=true`: the repositories keyed by their full path
// (`<accountId>/<name>`), each with its tags.
const catalogSchema = object({
	repositories: optional(record(string(), array(string()))),
})

/** A short-lived login to the account's registry. */
export interface RegistryCredentials {
	readonly accountId: string
	readonly username: string
	readonly password: string
}

function basicAuthorization(credentials: RegistryCredentials): string {
	return `Basic ${Buffer.from(`${REGISTRY_API_USER}:${credentials.password}`).toString('base64')}`
}

/**
 * Mint credentials for the account's registry, as `wrangler containers push`
 * does: the registry accepts no API token, only these, and they expire on
 * their own.
 */
export async function createRegistryCredentials(
	access: CloudflareApiAccess,
): Promise<RegistryCredentials> {
	const label = `Create credentials for ${CLOUDFLARE_CONTAINER_REGISTRY}`
	const envelope = await cloudflareRequest(
		access,
		{
			method: 'POST',
			path: `/accounts/${access.accountId}/containers/registries/${CLOUDFLARE_CONTAINER_REGISTRY}/credentials`,
			body: {
				expiration_minutes: CREDENTIALS_EXPIRATION_MINUTES,
				permissions: ['pull', 'push'],
			},
		},
		label,
	)
	const credentials = readResult(envelope, credentialsSchema, label)
	return { accountId: access.accountId, ...credentials }
}

interface RegistryCall {
	readonly method: 'GET' | 'HEAD' | 'DELETE' | 'PUT'
	readonly path: string
	readonly accept?: string
}

function registryFetch(
	credentials: RegistryCredentials,
	call: RegistryCall,
	label: string,
): Promise<Response> {
	return fetchWithRetry(
		`${REGISTRY_BASE}${call.path}`,
		{
			method: call.method,
			headers: {
				authorization: basicAuthorization(credentials),
				...(call.accept && { accept: call.accept }),
			},
		},
		label,
	)
}

function registryError(label: string, response: Response, body: string): Error {
	return new Error(
		`${label}: the registry returned HTTP ${String(response.status)}: ${body}`,
	)
}

/** The tags of the image `repository` in the registry, none when it is absent. */
async function listImageTags(
	credentials: RegistryCredentials,
	repository: string,
): Promise<ReadonlyArray<string>> {
	const label = `List the tags of container image "${repository}"`
	const response = await registryFetch(
		credentials,
		{ method: 'GET', path: '/v2/_catalog?tags=true' },
		label,
	)
	const body = await response.text()
	if (!response.ok) throw registryError(label, response, body)
	const catalog = safeParse(catalogSchema, JSON.parse(body))
	if (!catalog.success)
		throw new Error(`${label}: unexpected catalog shape:\n${body}`)
	// Keys may carry a leading slash; wrangler strips it too.
	const wanted = `${credentials.accountId}/${repository}`
	const entry = Object.entries(catalog.output.repositories ?? {}).find(
		([name]) => name.replace(LEADING_SLASHES, '') === wanted,
	)
	// The catalog also lists manifests by digest (`sha256:...`), which a kept
	// tag may point to: only tag names are candidates, as wrangler lists them.
	return (entry?.[1] ?? []).filter(tag => IMAGE_TAG_PATTERN.test(tag))
}

// Deleting a manifest by tag, as `wrangler containers images delete` does: a
// HEAD first finds whether the tag still exists, then the DELETE. The
// registry keeps the layers until a collection, which `collectLayers`
// requests.
async function deleteImageTag(
	credentials: RegistryCredentials,
	repository: string,
	tag: string,
): Promise<boolean> {
	const label = `Delete the tag "${tag}" of container image "${repository}"`
	const manifest = {
		path: `/v2/${credentials.accountId}/${repository}/manifests/${tag}`,
		accept: MANIFEST_ACCEPT,
	}
	const head = await registryFetch(
		credentials,
		{ method: 'HEAD', ...manifest },
		label,
	)
	if (head.status === HTTP_NOT_FOUND) return false
	if (!head.ok) throw registryError(label, head, '')
	const response = await registryFetch(
		credentials,
		{ method: 'DELETE', ...manifest },
		label,
	)
	if (response.status === HTTP_NOT_FOUND) return false
	if (!response.ok)
		throw registryError(label, response, await response.text())
	return true
}

// Layers no manifest references any more are freed on request, as
// `wrangler containers images delete` requests it after each deletion.
async function collectLayers(credentials: RegistryCredentials): Promise<void> {
	const label = 'Collect the unreferenced layers of the container registry'
	const response = await registryFetch(
		credentials,
		{ method: 'PUT', path: '/v2/gc/layers' },
		label,
	)
	if (response.ok) return
	throw registryError(label, response, await response.text())
}

/**
 * Delete every tag of the image `repository` except `keepTags`, then free
 * their layers. A tag already gone is simply not listed, so a re-run deletes
 * nothing more. Returns the tags deleted.
 */
export async function pruneImageTags(
	credentials: RegistryCredentials,
	repository: string,
	keepTags: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
	const doomed = (await listImageTags(credentials, repository)).filter(
		tag => !keepTags.includes(tag),
	)
	if (!doomed.length) {
		logger.info(`Container image "${repository}": no tag to delete`)
		return []
	}
	const deleted = await Promise.all(
		doomed.map(tag => deleteImageTag(credentials, repository, tag)),
	)
	await collectLayers(credentials)
	const removed = doomed.filter((_, index) => deleted[index])
	logger.info(
		`Container image "${repository}": deleted tag(s) ${removed.join(', ')}`,
	)
	return removed
}
