import { planCommand } from './plan.command.js'
import { prodGateCommand } from './prod-gate.command.js'
import { publishResultCommand } from './publish-result.command.js'

type Command = () => void | Promise<void>

const COMMANDS: Record<string, Command> = {
	plan: planCommand,
	'prod-gate': prodGateCommand,
	'publish-result': publishResultCommand,
}

export async function runCommand(name: string): Promise<void> {
	const command = COMMANDS[name]
	if (!command) {
		throw new Error(
			`Unknown command: ${name}. Available: ${Object.keys(COMMANDS).join(', ')}`,
		)
	}
	await command()
}
