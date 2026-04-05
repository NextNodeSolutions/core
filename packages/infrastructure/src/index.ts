import { runCommand } from './cli/commands.ts'

const commandName = process.argv[2] ?? 'plan'
await runCommand(commandName)
