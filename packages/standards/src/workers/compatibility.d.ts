export declare const WORKERS_COMPATIBILITY_DATE: string

export declare const WORKERS_COMPATIBILITY_FLAGS: string[]

export declare const parseWorkerdCompatibilityDate: (version: string) => string

export declare const isRuntimeCompatible: (
	workerdDate: string,
	requiredDate: string,
) => boolean

export declare const buildWranglerDevArgs: (
	passthrough: string[],
	date: string,
	flags: string[],
) => string[]
