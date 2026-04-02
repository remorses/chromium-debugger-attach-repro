// Minimal service worker so Playwright can discover this fixture extension ID.
chrome.runtime.onInstalled.addListener(() => {})

globalThis.reproExtensionKind = 'fixture-extension'
