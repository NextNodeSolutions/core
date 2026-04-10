type Command = () => void | Promise<void>

const COMMANDS: Record<string, Command> = {}

export async function runCommand(name: string): Promise<void> {
	const command = COMMANDS[name]
	if (!command) {
		const available =
			Object.keys(COMMANDS).join(', ') || '(none registered)'
		throw new Error(`Unknown command: ${name}. Available: ${available}`)
	}
	await command()
}
