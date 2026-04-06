import { defineConfig } from 'oxlint'

import standardsConfig from './src/oxlint/base.js'

export default defineConfig({
	extends: [standardsConfig],
})
