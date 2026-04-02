# Chromium Debugger Attach Repro

Minimal standalone repro for a Chromium bug where `chrome.debugger.attach`
fails if the target page embeds another extension's `chrome-extension://` page
in an iframe.

## What It Does

- loads a tiny **fixture extension** that exposes `page.html`
- loads a separate **debugger extension** that calls raw
  `chrome.debugger.attach`
- opens a normal control page and verifies attach succeeds
- opens a page with a `chrome-extension://.../page.html` iframe and verifies
  attach fails

This keeps the repro independent from Playwriter's workaround code.

## Run

```bash
pnpm install
pnpm repro
```

`pnpm install` downloads Playwright's Chromium automatically, so the repro
does not depend on any system Chrome or Chromium installation.

To watch the browser while debugging the repro:

```bash
HEADFUL=1 pnpm repro
```

## Expected Output

On affected Chromium builds, the script should print:

- **control page:** attach succeeds
- **iframe page:** attach fails with the exact error
  `Cannot access a chrome-extension:// URL of different extension`

If the bug stops reproducing, the script exits non-zero and prints the
unexpected result.
