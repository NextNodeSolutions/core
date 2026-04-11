import { tokenCommand } from './token.command.ts'

type Command = (args: readonly string[]) => void | Promise<void>

const COMMANDS: Record<string, Command> = {
	token: tokenCommand,
}

export async function runCommand(
	name: string,
	args: readonly string[] = [],
): Promise<void> {
	const command = COMMANDS[name]
	if (!command) {
		const available =
			Object.keys(COMMANDS).join(', ') || '(none registered)'
		throw new Error(`Unknown command: ${name}. Available: ${available}`)
	}
	await command(args)
}
