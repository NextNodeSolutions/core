type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
	debug: "\x1b[90m[debug]\x1b[0m",
	info: "\x1b[34m[info]\x1b[0m",
	warn: "\x1b[33m[warn]\x1b[0m",
	error: "\x1b[31m[error]\x1b[0m",
};

function currentLevel(): LogLevel {
	const env = process.env["LOG_LEVEL"]?.toLowerCase();
	if (env === "debug" || env === "info" || env === "warn" || env === "error") {
		return env;
	}
	return "info";
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;

	const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
	const formatted =
		args.length > 0
			? `${LEVEL_PREFIX[level]} ${message} ${args.map(String).join(" ")}`
			: `${LEVEL_PREFIX[level]} ${message}`;
	stream.write(`${formatted}\n`);
}

export const logger = {
	debug: (message: string, ...args: unknown[]) => log("debug", message, ...args),
	info: (message: string, ...args: unknown[]) => log("info", message, ...args),
	warn: (message: string, ...args: unknown[]) => log("warn", message, ...args),
	error: (message: string, ...args: unknown[]) => log("error", message, ...args),
};
