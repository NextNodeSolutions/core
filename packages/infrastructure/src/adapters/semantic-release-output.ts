import { readFileSync } from 'node:fs'

export function readSemanticReleaseOutput(path: string): string {
	return readFileSync(path, 'utf-8')
}
