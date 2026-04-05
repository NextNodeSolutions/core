/**
 * Template renderer (FR-11, FR-14)
 * React Email template rendering utilities
 */

import { render } from '@react-email/render'

import type {
	EmailTemplateComponent,
	RenderedTemplate,
	TemplateRenderOptions,
} from '../types/email.js'
import type { EmailError, Result } from '../types/result.js'
import { emailFail } from '../types/result.js'

/**
 * Default render options
 */
const DEFAULT_OPTIONS: Required<TemplateRenderOptions> = {
	plainText: true,
	pretty: false,
}

/**
 * Render a React Email template to HTML and optionally plain text (FR-11)
 *
 * Returns a Result to handle rendering failures gracefully (EC-1).
 * Never throws — all errors are returned as TEMPLATE_ERROR.
 *
 * @param template - React Email component function
 * @param props - Props to pass to the template
 * @param options - Render options (FR-12)
 * @returns Result with rendered HTML and optional text
 */
export async function renderTemplate<TProps>(
	template: EmailTemplateComponent<TProps>,
	props: TProps,
	options: TemplateRenderOptions = {},
): Promise<Result<RenderedTemplate, EmailError>> {
	const config = { ...DEFAULT_OPTIONS, ...options }

	try {
		// Create React element from the template component (FR-13)
		const element = template(props)

		// Render to HTML using @react-email/render (FR-14)
		const html = await render(element as React.ReactElement, {
			...(config.pretty !== undefined && {
				pretty: config.pretty,
			}),
		})

		// Optionally generate plain text version
		let text: string | undefined
		if (config.plainText) {
			text = await render(element as React.ReactElement, {
				plainText: true,
			})
		}

		return { success: true, data: { html, text } }
	} catch (error) {
		// EC-1: Template rendering fails → return TEMPLATE_ERROR, never throw
		return emailFail(
			'TEMPLATE_ERROR',
			error instanceof Error
				? `Template rendering failed: ${error.message}`
				: 'Template rendering failed: unknown error',
			{ originalError: error },
		)
	}
}
