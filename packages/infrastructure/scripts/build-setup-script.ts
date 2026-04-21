import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildSetupScript } from '../src/domain/hetzner/build-setup-script.ts'

const OUTPUT_PATH = resolve(import.meta.dirname, '../packer/scripts/setup.sh')

writeFileSync(OUTPUT_PATH, buildSetupScript())
