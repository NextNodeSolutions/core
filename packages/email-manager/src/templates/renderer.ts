/**
 * Template renderer (FR-11, FR-14)
 * React Email template rendering utilities
 */

import { render } from '@react-email/render'

import { emailFail } from '../types/result.js'

import type {
	EmailTemplateComponent,
	RenderedTemplate,
	TemplateRenderOptions,
} from '../types/email.js'
import type { EmailError, Result } from '../types/result.js'

type ResolvedRenderOptions = {
	[K in keyof TemplateRenderOptions]-?: NonNullable<TemplateRenderOptions[K]>
}

/**
 * Default render options
 */
const DEFAULT_OPTIONS: ResolvedRenderOptions = {
	plainText: true,
	pretty: false,
}

// An option passed as undefined takes its default, as an omitted one does.
const resolveOptions = (
	options: TemplateRenderOptions,
): ResolvedRenderOptions => ({
	plainText: options.plainText ?? DEFAULT_OPTIONS.plainText,
	pretty: options.pretty ?? DEFAULT_OPTIONS.pretty,
})

/**
 * Render a React Email template to HTML and optionally plain text (FR-11)
 *
 * Returns a Result to handle rendering failures gracefully (EC-1).
 * Never throws - all errors are returned as TEMPLATE_ERROR.
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
	const config = resolveOptions(options)

	try {
		// Create React element from the template component (FR-13)
		const element = template(props)

		// Render to HTML using @react-email/render (FR-14)
		const html = await render(element, { pretty: config.pretty })

		// Optionally generate plain text version
		let text: string | undefined
		if (config.plainText) {
			text = await render(element, {
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
