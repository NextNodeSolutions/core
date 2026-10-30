# brand-assets

This package ships the NextNode brand artwork as static SVG and PNG files behind subpath exports. Read [README.md](README.md) for how projects consume it, and the [root AGENTS.md](../../AGENTS.md) for the monorepo rules.

## Contracts

- **Treat every import path as a public contract.** Projects import files by folder and file name, so renaming or removing one breaks their builds. Ship such a change as a breaking change under the root commit rules, or add the new file beside the old one.
- **Keep the package static, with no code, no build step and no dependencies.** The subpath exports point straight at the published files, and the consumers' bundlers do the rest. Anything generated would have to be committed anyway.
- **Keep every asset inside a kind folder under `src`.** Only folder subpaths are exported, so a file outside a kind folder cannot be imported.
- **Keep the `[package]` section of `nextnode.toml`.** The shared pipeline publishes a package only when that section is present.

## Naming

- **Name a new folder after its kind in the plural, and start every file in it with the kind in the singular.** `logos-square` holds `logo-square-*` files. The import path then reads as kind and variant, and the README can describe a pattern instead of listing files.
- **Build every file name as `KIND[-VARIANT][-short][-mini].EXT`, in lowercase kebab-case, with the suffixes in that order.** Consumers derive paths from this pattern. A suffix out of order gives a path nobody guesses.
- **Use a color as the variant of a mark, and a background theme as the variant of an asset that carries its own background.** The README's rules for choosing a variant depend on that distinction.

## Artwork

- **Ship every variant as an SVG, a full PNG at three times the SVG's viewBox size, and a mini PNG at the viewBox size.** Consumers switch format by changing the extension or adding `-mini`. A missing format is a broken import for them.
- **Never edit an SVG by hand without the source design.** The SVG and both PNGs of a variant are exports of one design. A hand edit makes the formats disagree with each other and with the brand guidelines. Export every format again from the updated design.
- **Replace artwork under the same file names.** Same names keep every import working, so the change ships as a `fix` or a `feat`, never as a breaking change.

## Extending

### Add a variant to an existing kind

1. Export the SVG and both PNGs from the source design.
2. Name them by the pattern and put them in the kind's folder.
3. Leave `package.json` alone. The folder's wildcard export already covers new files.
4. When the variant adds a new choice, such as a new color, add a rule for it under "Choosing a variant" in the README.
5. Run the checks below on that folder.

### Add a kind

1. Create its folder under `src`, named by the rule above.
2. Add its variants as in the previous recipe.
3. Add a wildcard entry to `exports` in `package.json` that maps `./FOLDER/*` to the same folder under `src`.
4. Leave `files` alone. It already publishes the whole `src` folder.
5. Add a rule for choosing the new kind or its variants to the README when the choice is not obvious.
6. Run the checks below.

## Releasing

- **Expect a release only from commits that touch this package.** The package's release workflow runs on changes under its directory or by hand, and semantic-release counts only the commits under that directory. The shared package pipeline publishes from `main`. Its lint and build steps find no script here and do nothing.

## Checks

The package has no scripts. Run these from its directory.

Every file must resolve through a subpath export. This prints nothing on success, and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for a file in a folder without an export entry:

```bash
node --input-type=module -e "import { readdirSync } from 'node:fs'; for (const dir of readdirSync('src')) for (const file of readdirSync('src/' + dir)) import.meta.resolve('@nextnode-solutions/brand-assets/' + dir + '/' + file)"
```

Every SVG in the folder you changed must have both PNGs. This prints each missing file:

```bash
for svg in src/FOLDER/*.svg; do base=${svg%.svg}; for png in "$base.png" "$base-mini.png"; do [ -f "$png" ] || echo "missing $png"; done; done
```

Compare the PNG sizes with the SVG viewBox:

```bash
file src/FOLDER/*.png
grep -o 'viewBox="[^"]*"' src/FOLDER/*.svg
```

List what npm would publish:

```bash
npm pack --dry-run
```
