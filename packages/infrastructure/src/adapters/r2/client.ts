import type {
	ObjectStoreClient,
	ObjectStoreEntry,
} from '#/domain/storage/object-store.ts'
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'

import type { R2ClientConfig } from './client.types.ts'

export class R2Client implements ObjectStoreClient {
	private readonly s3: S3Client
	private readonly bucket: string

	constructor(config: R2ClientConfig, s3?: S3Client) {
		this.bucket = config.bucket
		this.s3 =
			s3 ??
			new S3Client({
				region: 'auto',
				endpoint: config.endpoint,
				credentials: {
					accessKeyId: config.accessKeyId,
					secretAccessKey: config.secretAccessKey,
				},
			})
	}

	async get(key: string): Promise<ObjectStoreEntry | null> {
		try {
			const response = await this.s3.send(
				new GetObjectCommand({ Bucket: this.bucket, Key: key }),
			)
			const body = await response.Body?.transformToString()
			if (body === undefined) {
				throw new Error(`R2 get "${key}": empty body`)
			}
			return { body, etag: response.ETag ?? '' }
		} catch (error) {
			if (error instanceof NoSuchKey) return null
			throw new Error(`R2 get "${key}"`, { cause: error })
		}
	}

	async put(key: string, body: string, ifMatch?: string): Promise<string> {
		const response = await this.s3.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: body,
				ContentType: 'application/json',
				IfMatch: ifMatch,
			}),
		)
		return response.ETag ?? ''
	}

	async delete(key: string): Promise<void> {
		await this.s3.send(
			new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
		)
	}

	async exists(key: string): Promise<boolean> {
		try {
			await this.s3.send(
				new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
			)
			return true
		} catch (error) {
			if (error instanceof NoSuchKey) return false
			const name = error instanceof Error ? error.name : ''
			if (name === 'NotFound' || name === '404') return false
			throw new Error(`R2 exists "${key}"`, { cause: error })
		}
	}

	async deleteByPrefix(prefix: string): Promise<number> {
		let deletedCount = 0
		let continuationToken: string | undefined

		/* eslint-disable no-await-in-loop -- pagination is intentionally sequential */
		do {
			const listResponse = await this.s3.send(
				new ListObjectsV2Command({
					Bucket: this.bucket,
					Prefix: prefix,
					ContinuationToken: continuationToken,
				}),
			)

			const keysToDelete: Array<{ Key: string }> = []
			for (const object of listResponse.Contents ?? []) {
				if (typeof object.Key === 'string') {
					keysToDelete.push({ Key: object.Key })
				}
			}

			if (keysToDelete.length > 0) {
				await this.s3.send(
					new DeleteObjectsCommand({
						Bucket: this.bucket,
						Delete: { Objects: keysToDelete },
					}),
				)
				deletedCount += keysToDelete.length
			}

			continuationToken = listResponse.NextContinuationToken
		} while (continuationToken !== undefined)
		/* eslint-enable no-await-in-loop */

		return deletedCount
	}
}
