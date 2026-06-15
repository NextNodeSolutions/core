// Pipeline-proof test for the React island integration. It does NOT ship an
// island: the component is defined inline here purely to exercise the full
// stack the next commits rely on: jsdom environment, @testing-library/react
// rendering, @testing-library/user-event interaction, and a Jotai atom driving
// state. When a real island lands under `src/islands/**`, it is authored as a
// `.tsx` component and mounted in an `.astro` page with a client directive
// (e.g. `<Counter client:load />` / `client:visible`); its test mirrors this
// file's render + interact + assert shape.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, useAtom } from 'jotai'
import { describe, expect, it } from 'vitest'

const countAtom = atom(0)

function Counter(): React.ReactElement {
	const [count, setCount] = useAtom(countAtom)

	return (
		<button type="button" onClick={() => setCount(c => c + 1)}>
			count: {count}
		</button>
	)
}

describe('react island pipeline (jsdom + RTL + jotai)', () => {
	it('renders the initial atom value and updates it on click', async () => {
		const user = userEvent.setup()
		render(<Counter />)

		const button = screen.getByRole('button', { name: 'count: 0' })
		expect(button).toBeDefined()

		await user.click(button)
		expect(screen.getByRole('button', { name: 'count: 1' })).toBeDefined()

		await user.click(button)
		expect(screen.getByRole('button', { name: 'count: 2' })).toBeDefined()

		// The initial-value label must be gone once state advanced. Guards
		// against a tautological test that would pass even if click did nothing.
		expect(screen.queryByRole('button', { name: 'count: 0' })).toBeNull()
	})
})
