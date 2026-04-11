import { runCommand } from './cli/commands.ts'

const COMMAND_ARG_INDEX = 2
const [commandName = 'serve', ...commandArgs] =
	process.argv.slice(COMMAND_ARG_INDEX)
await runCommand(commandName, commandArgs)
