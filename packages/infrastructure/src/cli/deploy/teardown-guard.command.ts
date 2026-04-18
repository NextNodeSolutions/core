import { createLogger } from '@nextnode-solutions/logger'

import type { NextNodeConfig } from '../../config/types.ts'
import { verifyTeardownConfirmation } from '../../domain/deploy/verify-teardown-confirmation.ts'
import { getEnv } from '../env.ts'

const logger = createLogger()

export function teardownGuardCommand(config: NextNodeConfig): void {
	verifyTeardownConfirmation(config.project.name, getEnv('TEARDOWN_CONFIRM'))
	logger.info(`Teardown confirmation verified for "${config.project.name}"`)
}
