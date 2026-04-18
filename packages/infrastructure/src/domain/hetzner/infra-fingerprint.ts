import { createHash } from 'node:crypto'

const FINGERPRINT_LENGTH = 16

export function computeInfraFingerprint(
	fileContents: ReadonlyArray<string>,
): string {
	const hash = createHash('sha256')
	for (const content of fileContents) {
		hash.update(content)
	}
	return hash.digest('hex').slice(0, FINGERPRINT_LENGTH)
}
