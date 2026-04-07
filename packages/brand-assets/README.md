# @nextnode-solutions/brand-assets

NextNode Solutions brand assets — logos, icons, favicons, and social avatars.

Based on Brand Guidelines v2.0 (December 2024).

## Installation

```bash
pnpm add @nextnode-solutions/brand-assets
```

## Usage

Import assets directly via subpath exports:

```tsx
// Icons (symbol only) — teal, white, black
import iconTeal from '@nextnode-solutions/brand-assets/icons/icon-teal.svg'

// Icons with text — teal, white, black
import iconTextTeal from '@nextnode-solutions/brand-assets/icons-text/icon-text-teal.svg'

// Square logos (400x400) — teal, white, black
import logoSquare from '@nextnode-solutions/brand-assets/logos-square/logo-square-teal.svg'

// Landscape logos (500x100) — teal, white, black + short variants
import logoLandscape from '@nextnode-solutions/brand-assets/logos-landscape/logo-landscape-teal.svg'
import logoShort from '@nextnode-solutions/brand-assets/logos-landscape/logo-landscape-teal-short.svg'

// Social avatars (400x400) — dark, light
import avatarDark from '@nextnode-solutions/brand-assets/social/avatar-dark.svg'

// Favicon
import favicon from '@nextnode-solutions/brand-assets/favicon/favicon.svg'
```

## Available Assets

| Export Path | Variants | Formats |
|---|---|---|
| `./icons/*` | teal, white, black | SVG, PNG, PNG mini |
| `./icons-text/*` | teal, white, black | SVG, PNG, PNG mini |
| `./logos-square/*` | teal, white, black | SVG, PNG, PNG mini |
| `./logos-landscape/*` | teal, white, black + short variants | SVG, PNG, PNG mini |
| `./social/*` | dark, light | SVG, PNG |
| `./favicon/*` | — | SVG, PNG, PNG mini |

## Variant Guide

- **Teal**: Default — use on light backgrounds
- **White**: Use on dark backgrounds
- **Black**: Use for B&W print
- **Short**: "NextNode" only (no "Solutions")
- **Mini PNG**: Optimized small raster fallbacks
