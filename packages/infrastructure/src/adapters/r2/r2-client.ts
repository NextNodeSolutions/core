import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	NoSuchKey,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3'

import type { R2ClientConfig, R2Object } from './r2-client.types.ts'

export class R2Client {
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

	async get(key: string): Promise<R2Object | null> {
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
		const metadata = ifMatch ? { 'if-match': ifMatch } : undefined

		const response = await this.s3.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: body,
				ContentType: 'application/json',
				Metadata: metadata,
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
}
