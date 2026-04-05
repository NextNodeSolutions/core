/**
 * Template renderer tests
 * Mock @react-email/render (external boundary) to verify rendering orchestration
 */
import { describe, expect, it, vi } from 'vitest'

import { renderTemplate } from '../src/templates/renderer.js'

// Mock @react-email/render — external rendering library, no DOM needed
vi.mock('@react-email/render', () => ({
	render: vi.fn(),
}))

const { render: mockRender } = await import('@react-email/render')

interface TestProps {
	name: string
}

const testTemplate = (props: TestProps) =>
	({
		type: 'div',
		props: { children: `Hello ${props.name}` },
	}) as unknown as React.ReactElement

describe('renderTemplate() (FR-11, FR-14) — success paths', () => {
	it('returns the rendered html in a success Result', async () => {
		vi.mocked(mockRender)
			.mockResolvedValueOnce('<div>Hello World</div>')
			.mockResolvedValueOnce('Hello World')

		const result = await renderTemplate(testTemplate, { name: 'World' })

		expect(result).toEqual({
			success: true,
			data: { html: '<div>Hello World</div>', text: 'Hello World' },
		})
	})

	it('generates a plain-text version by default (two render calls)', async () => {
		vi.mocked(mockRender)
			.mockResolvedValueOnce('<div>Hello</div>')
			.mockResolvedValueOnce('Hello')

		await renderTemplate(testTemplate, { name: 'Test' })

		expect(mockRender).toHaveBeenCalledTimes(2)
		expect(mockRender).toHaveBeenNthCalledWith(2, expect.anything(), {
			plainText: true,
		})
	})

	it('skips plain-text generation when plainText: false', async () => {
		vi.mocked(mockRender).mockResolvedValueOnce('<div>Hi</div>')

		const result = await renderTemplate(
			testTemplate,
			{ name: 'Test' },
			{ plainText: false },
		)

		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.text).toBeUndefined()
		}
		expect(mockRender).toHaveBeenCalledTimes(1)
	})

	it('forwards the pretty option to the html render call', async () => {
		vi.mocked(mockRender)
			.mockResolvedValueOnce('<div>\n  Hello\n</div>')
			.mockResolvedValueOnce('Hello')

		await renderTemplate(testTemplate, { name: 'Test' }, { pretty: true })

		expect(mockRender).toHaveBeenNthCalledWith(1, expect.anything(), {
			pretty: true,
		})
	})

	it('applies default options (pretty: false, plainText: true) when none provided', async () => {
		vi.mocked(mockRender)
			.mockResolvedValueOnce('<div>Hello</div>')
			.mockResolvedValueOnce('Hello')

		await renderTemplate(testTemplate, { name: 'Test' })

		expect(mockRender).toHaveBeenNthCalledWith(1, expect.anything(), {
			pretty: false,
		})
		expect(mockRender).toHaveBeenNthCalledWith(2, expect.anything(), {
			plainText: true,
		})
	})
})

describe('renderTemplate() — error handling (EC-1, never throws)', () => {
	it('returns TEMPLATE_ERROR with the original error when render() rejects', async () => {
		const originalError = new Error('Invalid component')
		vi.mocked(mockRender).mockRejectedValue(originalError)

		const result = await renderTemplate(testTemplate, { name: 'Test' })

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.code).toBe('TEMPLATE_ERROR')
			expect(result.error.message).toContain('Invalid component')
			expect(result.error.originalError).toBe(originalError)
		}
	})

	it('returns TEMPLATE_ERROR with "unknown error" when a non-Error value is thrown', async () => {
		vi.mocked(mockRender).mockRejectedValue('string error')

		const result = await renderTemplate(testTemplate, { name: 'Test' })

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.code).toBe('TEMPLATE_ERROR')
			expect(result.error.message).toContain('unknown error')
		}
	})

	it('catches synchronous throws from the template function itself', async () => {
		const badTemplate = () => {
			throw new Error('Component crash')
		}

		const result = await renderTemplate(badTemplate as never, {})

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.code).toBe('TEMPLATE_ERROR')
			expect(result.error.message).toContain('Component crash')
		}
	})
})
