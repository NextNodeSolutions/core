import { isRecord } from '@/config/types.ts'
import { HTTP_NOT_FOUND } from '@/domain/http/status.ts'

import {
	HCLOUD_API_BASE,
	authHeaders,
	formatLabelSelector,
	requireOk,
} from './base.ts'

export interface HcloudImageResponse {
	readonly id: number
	readonly description: string
	readonly created: string
	readonly status: string
	readonly labels: Readonly<Record<string, string>>
}

export interface CreateSnapshotInput {
	readonly description: string
	readonly labels: Readonly<Record<string, string>>
}

function parseImageObject(img: unknown, context: string): HcloudImageResponse {
	if (
		!isRecord(img) ||
		typeof img.id !== 'number' ||
		typeof img.description !== 'string' ||
		typeof img.created !== 'string' ||
		typeof img.status !== 'string'
	) {
		throw new Error(`${context}: invalid image shape`)
	}
	// Manual runtime narrowing - img.labels is untyped (unknown).
	// TODO: replace with schema validation (e.g. Zod) when we add one.
	const labels: Record<string, string> = {}
	if (isRecord(img.labels)) {
		for (const [k, v] of Object.entries(img.labels)) {
			if (typeof v === 'string') labels[k] = v
		}
	}
	return {
		id: img.id,
		description: img.description,
		created: img.created,
		status: img.status,
		labels,
	}
}

export async function findImagesByLabels(
	token: string,
	labels: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<HcloudImageResponse>> {
	const selector = formatLabelSelector(labels)
	const url = new URL(`${HCLOUD_API_BASE}/images`)
	url.searchParams.set('type', 'snapshot')
	url.searchParams.set('label_selector', selector)
	const response = await fetch(url, { headers: authHeaders(token) })
	await requireOk(response, `list images label_selector="${selector}"`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !Array.isArray(data.images)) {
		throw new Error(
			`list images label_selector="${selector}": missing \`images\` array`,
		)
	}
	const images: ReadonlyArray<unknown> = data.images
	return images.map((img, i) => parseImageObject(img, `images[${i}]`))
}

export async function findImageById(
	token: string,
	imageId: number,
): Promise<HcloudImageResponse | null> {
	const response = await fetch(`${HCLOUD_API_BASE}/images/${imageId}`, {
		headers: authHeaders(token),
	})
	if (response.status === HTTP_NOT_FOUND) return null
	await requireOk(response, `find image ${imageId}`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !isRecord(data.image)) {
		throw new Error(`find image ${imageId}: missing \`image\` in response`)
	}
	return parseImageObject(data.image, `find image ${imageId}`)
}

export async function deleteImage(
	token: string,
	imageId: number,
): Promise<void> {
	const response = await fetch(`${HCLOUD_API_BASE}/images/${imageId}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	})
	await requireOk(response, `delete image ${imageId}`)
}

export async function createSnapshot(
	token: string,
	serverId: number,
	input: CreateSnapshotInput,
): Promise<HcloudImageResponse> {
	const response = await fetch(
		`${HCLOUD_API_BASE}/servers/${serverId}/actions/create_image`,
		{
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				type: 'snapshot',
				description: input.description,
				labels: input.labels,
			}),
		},
	)
	await requireOk(response, `create snapshot of server ${serverId}`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !isRecord(data.image)) {
		throw new Error(
			`create snapshot of server ${serverId}: missing \`image\` in response`,
		)
	}
	return parseImageObject(data.image, `create snapshot of server ${serverId}`)
}
