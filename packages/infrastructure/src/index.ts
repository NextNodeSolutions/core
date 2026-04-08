import { runCommand } from './cli/commands.ts'

const COMMAND_ARG_INDEX = 2
const commandName = process.argv[COMMAND_ARG_INDEX] ?? 'plan'
await runCommand(commandName)
