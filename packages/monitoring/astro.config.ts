import node from '@astrojs/node'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	server: {
		host: '0.0.0.0',
		port: Number(process.env.PORT ?? 4321),
	},
	site: process.env.SITE_URL,
	vite: {
		plugins: [tailwindcss()],
	},
})
