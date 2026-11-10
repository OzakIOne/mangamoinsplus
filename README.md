# Mangamoins+

A Chrome/Firefox extension that downloads manga chapters as image files from [mangamoins.com](https://mangamoins.com) and [raijin-scans.fr](https://raijin-scans.fr), built with [WXT](https://wxt.dev) and React.

## What it does

- **Auto-detects chapters**: open any chapter page on a supported site and the popup shows the manga title, chapter number, and page count.
- **One-click download**: the whole chapter is packed into a single `.cbz` archive (e.g. `One Piece/Chapter 1100.cbz`) ready for any comic reader. Untick **Regrouper en un fichier .cbz** to get the pages as separate image files instead.
- **Works around anti-hotlinking**: images are fetched through the page itself (same session, real cookies), with a `declarativeNetRequest` rule that adds the missing CORS headers on the image CDN, so the extension can still read the bytes.
- **Tolerates incomplete chapters**: if the site advertises more pages than its CDN serves (inserted ad pages, deleted pages), the missing ones are skipped instead of aborting the whole download.
- **Robust page detection**: reads the reader's embedded image list first, then falls back to scanning loaded images / probing URL patterns — including split chapters like `346-1`, `346-2`.

## Install in your browser

### From a release (recommended)

1. Grab the latest `mangamoinsplus-*.zip` from the [GitHub Releases](../../releases) page and unzip it.
2. Open `chrome://extensions` in Chrome (or Edge/Brave/etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder (`mangamoinsplus-chrome-mv3`).

The icon appears in your toolbar — pin it if you want quick access.

### From source

Requires [Bun](https://bun.sh).

```bash
git clone <this-repo>
cd mangamoinsplus
bun install
bun run build
```

Then follow steps 2–4 above, selecting `build/mangamoinsplus-chrome-mv3`.

### Firefox

Only temporary installation is supported (unsigned extension):

```bash
bun run build:firefox
```

Then open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick `manifest.json` inside `build/mangamoinsplus-firefox-mv3`. You'll need to reload it after restarting Firefox.

## Usage

1. Navigate to a chapter page on mangamoins.com or raijin-scans.fr.
2. Click the extension icon — the chapter is detected automatically.
3. Hit **Download Chapter**. The chapter lands in your default Downloads folder as a `.cbz` file (or as a folder of images if you untick the checkbox).

If a download fails, open the small **debug** link at the bottom of the popup: it shows the extension version, the build stamps of the popup and the service worker (handy to check a reload actually happened), the detected chapter data, and the first few failed URLs with their HTTP status.

## Development

```bash
bun install       # install dependencies (also runs `wxt prepare`)
bun run dev       # start dev mode with auto-reload
bun run compile   # type-check (tsc --noEmit)
bun run build     # production build for Chrome
bun run zip       # package the built extension as a zip
```

Firefox variants: `bun run dev:firefox` and `bun run build:firefox`.
