export abstract class UpstreamApiFailure extends Error {
	constructor(
		public readonly context: string,
		public readonly httpStatus: number,
		message: string,
	) {
		super(message)
		this.name = new.target.name
	}

	abstract logContext(): Record<string, unknown>
}
