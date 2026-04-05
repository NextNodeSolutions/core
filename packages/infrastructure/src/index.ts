import { runCommand } from './cli/commands.js'

const commandName = process.argv[2] ?? 'plan'
await runCommand(commandName)
