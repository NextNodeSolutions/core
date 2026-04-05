import { dnsCommand } from './dns.command.ts'
import { ensurePagesDomainsCommand } from './pages-domains.command.ts'
import { ensurePagesProjectCommand } from './pages-project.command.ts'
import { planCommand } from './plan.command.ts'
import { prodGateCommand } from './prod-gate.command.ts'
import { publishResultCommand } from './publish-result.command.ts'

type Command = () => void | Promise<void>

const COMMANDS: Record<string, Command> = {
	plan: planCommand,
	'prod-gate': prodGateCommand,
	'publish-result': publishResultCommand,
	dns: dnsCommand,
	'ensure-pages-project': ensurePagesProjectCommand,
	'ensure-pages-domains': ensurePagesDomainsCommand,
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
