// Extension page helpers that call raw chrome.debugger attach/detach on the active tab.
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab || typeof tab.id !== 'number') {
    throw new Error('No active tab found')
  }
  return tab
}

globalThis.attachToActiveTab = async () => {
  const tab = await getActiveTab()
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3')
    return { ok: true, tabId: tab.id, url: tab.url || '', error: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, tabId: tab.id, url: tab.url || '', error: message }
  }
}

globalThis.detachFromActiveTab = async () => {
  const tab = await getActiveTab()
  try {
    await chrome.debugger.detach({ tabId: tab.id })
    return { ok: true, tabId: tab.id, error: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, tabId: tab.id, error: message }
  }
}
