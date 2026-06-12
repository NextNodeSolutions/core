import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'
import { isRecord } from '#/kernel/guards.ts'

import {
	HCLOUD_API_BASE,
	authHeaders,
	formatLabelSelector,
	narrowStringLabels,
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
	return {
		id: img.id,
		description: img.description,
		created: img.created,
		status: img.status,
		labels: narrowStringLabels(img.labels),
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
	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || !Array.isArray(responseBody.images)) {
		throw new Error(
			`list images label_selector="${selector}": missing \`images\` array`,
		)
	}
	const { images } = responseBody
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
	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || !isRecord(responseBody.image)) {
		throw new Error(`find image ${imageId}: missing \`image\` in response`)
	}
	return parseImageObject(responseBody.image, `find image ${imageId}`)
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
	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || !isRecord(responseBody.image)) {
		throw new Error(
			`create snapshot of server ${serverId}: missing \`image\` in response`,
		)
	}
	return parseImageObject(
		responseBody.image,
		`create snapshot of server ${serverId}`,
	)
}
