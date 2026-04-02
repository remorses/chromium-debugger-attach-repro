/**
 * Standalone Chromium repro runner for chrome.debugger.attach failures on pages
 * that embed another extension in an iframe.
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright'

type AttachResult = {
  ok: boolean
  tabId: number
  url: string
  error: string
}

type DetachResult = {
  ok: boolean
  tabId: number
  error: string
}

type ReproServer = {
  baseUrl: string
  close: () => Promise<void>
}

const debuggerExtensionId = 'cimjjnhhjcoiebpoohgehojfbbljgenc'
const fixtureExtensionId = 'ihniknomcjlhlokfeidcmcjbbmpgngeh'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmpRoot = path.join(packageRoot, 'tmp')
const debuggerExtensionPath = path.join(packageRoot, 'extensions', 'debugger-repro-extension')
const fixtureExtensionPath = path.join(packageRoot, 'extensions', 'fixture-extension')

async function main(): Promise<void> {
  fs.mkdirSync(tmpRoot, { recursive: true })
  const userDataDir = fs.mkdtempSync(path.join(tmpRoot, 'user-data-'))
  const launchOptions = getLaunchOptions()
  const headless = process.env.HEADFUL !== '1'

  let browserContext: BrowserContext | null = null
  let server: ReproServer | null = null

  try {
    browserContext = await chromium.launchPersistentContext(userDataDir, {
      headless,
      ...launchOptions,
      args: [
        `--disable-extensions-except=${[debuggerExtensionPath, fixtureExtensionPath].join(',')}`,
        `--load-extension=${[debuggerExtensionPath, fixtureExtensionPath].join(',')}`,
      ],
    })

    server = await createServer({ fixtureExtensionId })
    const runnerPage = await browserContext.newPage()
    await runnerPage.goto(`chrome-extension://${debuggerExtensionId}/runner.html`, {
      waitUntil: 'domcontentloaded',
    })
    console.log('Debugger extension path:', debuggerExtensionPath)
    console.log('Fixture extension path:', fixtureExtensionPath)
    console.log('Debugger extension ID:', debuggerExtensionId)
    console.log('Fixture extension ID:', fixtureExtensionId)
    if (launchOptions.executablePath) {
      console.log('Browser executable:', launchOptions.executablePath)
    } else {
      console.log('Browser channel:', launchOptions.channel)
    }
    console.log('Headless:', headless)
    console.log('Repro server:', server.baseUrl)

    const controlResult = await runCase({
      browserContext,
      runnerPage,
      label: 'control',
      pageUrl: `${server.baseUrl}/clean`,
      waitForFixtureFrame: false,
    })

    const iframeResult = await runCase({
      browserContext,
      runnerPage,
      label: 'iframe',
      pageUrl: `${server.baseUrl}/with-extension-iframe`,
      waitForFixtureFrame: true,
    })

    assertExpectedResults({ controlResult, iframeResult })

    console.log('Repro succeeded: control attach passed and iframe attach failed.')
    process.exitCode = 0
  } finally {
    if (server) {
      await server.close()
    }
    if (browserContext) {
      await browserContext.close()
    }
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
}

function getLaunchOptions(): { channel?: 'chromium'; executablePath?: string } {
  const executablePath = findSystemChromiumExecutable()
  if (executablePath) {
    return { executablePath }
  }
  return { channel: 'chromium' }
}

function findSystemChromiumExecutable(): string | undefined {
  const platform = os.platform()
  const homeDir = os.homedir()

  const candidates: string[] = (() => {
    if (platform === 'darwin') {
      return [
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ]
    }

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
      return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
      ]
    }

    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ]
  })()

  return candidates.find((candidate) => {
    return fs.existsSync(candidate)
  })
}

async function runCase({
  browserContext,
  runnerPage,
  label,
  pageUrl,
  waitForFixtureFrame,
}: {
  browserContext: BrowserContext
  runnerPage: Page
  label: string
  pageUrl: string
  waitForFixtureFrame: boolean
}): Promise<AttachResult> {
  const page = await browserContext.newPage()

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()
    await page.waitForTimeout(250)

    if (waitForFixtureFrame) {
      await waitForFixtureIframe({ page })
    }

    const attachResult = (await runnerPage.evaluate(async () => {
      const runnerGlobal = globalThis as typeof globalThis & {
        attachToActiveTab?: () => Promise<AttachResult>
      }
      if (!runnerGlobal.attachToActiveTab) {
        throw new Error('attachToActiveTab is not available on runner page')
      }
      return await runnerGlobal.attachToActiveTab()
    })) as AttachResult

    console.log(`[${label}] page url: ${page.url()}`)
    console.log(`[${label}] attach result: ${JSON.stringify(attachResult)}`)

    if (attachResult.ok) {
      const detachResult = (await runnerPage.evaluate(async () => {
        const runnerGlobal = globalThis as typeof globalThis & {
          detachFromActiveTab?: () => Promise<DetachResult>
        }
        if (!runnerGlobal.detachFromActiveTab) {
          throw new Error('detachFromActiveTab is not available on runner page')
        }
        return await runnerGlobal.detachFromActiveTab()
      })) as DetachResult
      console.log(`[${label}] detach result: ${JSON.stringify(detachResult)}`)
    }

    return attachResult
  } finally {
    await page.close()
  }
}

async function waitForFixtureIframe({ page }: { page: Page }): Promise<void> {
  await page.locator('#ext-iframe').waitFor({ timeout: 5000 })
  await page.frameLocator('#ext-iframe').locator('#fixture').waitFor({ timeout: 5000 })
}

function assertExpectedResults({
  controlResult,
  iframeResult,
}: {
  controlResult: AttachResult
  iframeResult: AttachResult
}): void {
  if (!controlResult.ok) {
    throw new Error(`Control attach unexpectedly failed: ${controlResult.error}`)
  }

  if (iframeResult.ok) {
    throw new Error('Iframe attach unexpectedly succeeded; the bug did not reproduce.')
  }

  const errorText = iframeResult.error.toLowerCase()
  const looksLikeRestrictedTarget = errorText.includes('chrome-extension://') || errorText.includes('different extension')
  if (!looksLikeRestrictedTarget) {
    throw new Error(`Iframe attach failed with an unexpected error: ${iframeResult.error}`)
  }
}

async function createServer({ fixtureExtensionId }: { fixtureExtensionId: string }): Promise<ReproServer> {
  const sockets: Set<import('node:net').Socket> = new Set()

  const server = http.createServer((request, response) => {
    if (request.url === '/clean') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html><body><h1>clean control page</h1></body></html>`)
      return
    }

    if (request.url === '/with-extension-iframe') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html>
<html>
  <body>
    <h1>page with extension iframe</h1>
    <iframe
      id="ext-iframe"
      src="chrome-extension://${fixtureExtensionId}/page.html"
      style="width: 400px; height: 120px; border: 0"
    ></iframe>
  </body>
</html>`)
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine repro server address')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      sockets.forEach((socket) => {
        socket.destroy()
      })
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
