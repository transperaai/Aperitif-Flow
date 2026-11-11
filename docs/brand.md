# Brand: the name and logo people see

This deployment is **Aperitif Flow**. Only what people see carries that name; package names (`@transpera-flow/*`), env vars,
the database, file format ids (`transpera-process/2`, `transpera-workspace/1`, `application/vnd.transpera-process+json`),
localStorage keys and the ADRs/PRD keep `transpera`.

## Where the brand lives

| What | File | Used by |
|---|---|---|
| Product name | `apps/web/src/lib/brand.ts` → `BRAND.name`, `pageTitle()` | Root metadata (title, `applicationName`, Open Graph site name, Apple web-app title), page titles, sign-in (Better Auth `appName`), holding page, API tokens page, privacy policy, map image export footer |
| Wide logo | `apps/web/public/brand/logo.svg` (1076 × 254, the client's wordmark) | `<Logo />` in `apps/web/src/components/brand/logo.tsx`: sidebar, header outside a workspace, sign-in, privacy, not-found, error page |
| Word after the logo | `BRAND.logoSuffix` (`"Flow"`) | `<Logo />`; set it to `""` if the logo file already says the full product name |
| Square mark | `apps/web/public/brand/mark.svg` (256 × 256) | `<LogoMark />`: the collapsed (icon-only) sidebar |
| App icons | `apps/web/src/app/icon.svg`, `apple-icon.png` (180 × 180), `favicon.ico` (16, 32, 48) | Generated from `mark.svg` by `apps/web/scripts/brand-icons.mjs`; Next adds the `<link>` tags from these file names |
| Name in package messages | literal `Aperitif Flow` in `packages/db/src` (process-file and backup checks, the prompt for Claude, the link importer), `packages/engine/src/broken.ts` and `scenario.ts`, `packages/mcp/src/handler.ts`; MCP server name `aperitif-flow` in `packages/mcp/src/tools.ts` | Upload/restore errors, the MCP server |
| Process-file schemas | `docs/import/transpera-process-{1,2}.schema.json` (title and description) | Kept equal to `packages/db/src/process-file*.ts` by a test |

The logo is an opaque coral pill with dark lettering, so it reads the same on the light and dark themes; no theme or accent
token touches it. The old Transpera mark (a conic gradient from `--brand-mark` and `--chart-1/5`) is gone, and so is the
`--brand-mark` token. `--chart-1..5` stay: they are chart colours.

## How the square mark was made

The client sent only the wide wordmark. `mark.svg` is a coral (`#E75E5E`) rounded square (256 × 256, corner radius 56) with the
logo's own "A" glyph (the third `<path>` in `logo.svg`, `#300B0B`) centred and scaled 1.32×. The glyph is copied unchanged, so it
is the client's letterform, not a font. It stays legible at 16 px (checked in the generated favicon). Replace it with the
client's own square mark if they send one.

## Dropping in a new logo

1. Put the new wide logo at `apps/web/public/brand/logo.svg`. SVG, plain paths, no scripts or external references. Any aspect
   ratio works; it is drawn 22 px tall.
2. Update `BRAND.logo` in `apps/web/src/lib/brand.ts`: `width` and `height` to the file's viewBox size, `alt` to what the logo
   says. Set `BRAND.logoSuffix` (`""` if the logo already names the product).
3. Put a square mark at `apps/web/public/brand/mark.svg` (256 × 256 viewBox, opaque background, legible at 16 px). With no square
   mark from the client, make one as above from a glyph of the logo.
4. From `apps/web`, run `node scripts/brand-icons.mjs`. It rewrites `src/app/icon.svg`, `src/app/apple-icon.png` and
   `src/app/favicon.ico` (set `CHROMIUM_PATH` if playwright-core's Chromium isn't found).
5. For a new product name: change `BRAND.name`, then
   `git grep -n "Aperitif" -- apps packages docs/import README.md` and change the literal strings in the packages and their tests.
   Run `pnpm lint && pnpm typecheck && pnpm test`.
6. If the deployment uses its own Google OAuth client, set the consent screen's app name and logo to match
   ([SETUP.md](../SETUP.md) §5).

## Where "Transpera" stays on purpose

Transpera AI is the vendor, so these keep the name: the privacy policy (provider, consultants, processor, contact
`austin@transpera.ai`), the holding page ("ask your company's owner or Transpera to add you"), the Owner role's description on
Settings → Access, and the shared Google OAuth client's consent screen.
