export interface R2Object {
	readonly body: string
	readonly etag: string
}

export interface R2ClientConfig {
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly bucket: string
}

export interface R2Operations {
	get(key: string): Promise<R2Object | null>
	put(key: string, body: string, ifMatch?: string): Promise<string>
	delete(key: string): Promise<void>
	exists(key: string): Promise<boolean>
}
