# Cloudflare Bypass Implementation Guide

<!--
─── GEB L3 自指注释 ─────────────────────────────────────────────────────
文件作用: 详细说明 Cloudflare 绕过的技术原理和实现
依赖关系: browser-fetcher.ts, cloudflare-bypass.ts (代码实现)
变更同步: 修改绕过策略时同步更新代码文件的 L3 注释
──────────────────────────────────────────────────────────────────────────
-->

## Overview

This document details how the resource-collector tool successfully bypasses Cloudflare protection to scrape protected websites like `appstorrent.ru`.

## Problem

Cloudflare's bot detection system blocks traditional HTTP requests and even regular browser automation tools (Playwright, Puppeteer) because:

1. **TLS Fingerprinting** - Cloudflare detects automated browsers by analyzing TLS handshake patterns
2. **JavaScript Challenges** - Cloudflare presents JavaScript challenges that require real browser execution
3. **Turnstile Captchas** - Modern Cloudflare uses Turnstile, an invisible captcha that verifies human behavior
4. **Browser Fingerprinting** - Detects automation through canvas, WebGL, audio context, and other fingerprints

## Solution: puppeteer-real-browser

We implemented `puppeteer-real-browser` - a specialized library that:

- Uses **real Chrome browser** with authentic TLS fingerprints
- Includes **built-in Turnstile solver** for Cloudflare challenges
- Implements **ghost-cursor** for human-like mouse movements
- Patched at source level to avoid automation detection

## Implementation Details

### 1. Install Dependencies

```bash
npm install puppeteer-real-browser
```

### 2. Browser Fetcher Module (`src/browser-fetcher.ts`)

```typescript
import type { Browser, Page } from "rebrowser-puppeteer-core";

let browser: Browser | null = null;
let page: Page | null = null;
let connectFunc: ((options: Options) => Promise<ConnectResult>) | null = null;

async function getBrowserPage(): Promise<{ browser: Browser; page: Page }> {
  if (!browser || !page) {
    console.log('  Launching real browser (puppeteer-real-browser)...');

    // Use dynamic import for ESM module compatibility
    if (!connectFunc) {
      const puppeteerRealBrowser = await import('puppeteer-real-browser');
      connectFunc = puppeteerRealBrowser.connect;
    }

    const result = await connectFunc({
      headless: false, // Visible browser required for Cloudflare bypass
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      connectOption: {
        defaultViewport: { width: 1920, height: 1080 },
      },
      turnstile: true, // Enable Cloudflare Turnstile solving
    });

    browser = result.browser;
    page = result.page;
  }

  return { browser, page };
}
```

### 3. Key Configuration Options

| Option | Value | Reason |
|--------|-------|--------|
| `headless` | `false` | Visible browser required; headless mode is detected by Cloudflare |
| `turnstile` | `true` | Enables automatic Turnstile captcha solving |
| `viewport` | `1920x1080` | Standard desktop resolution to avoid detection |

### 4. Cloudflare Challenge Handling

```typescript
// Wait for Cloudflare challenge to be solved
await new Promise(resolve => setTimeout(resolve, 10000));

// Check if still on challenge page
let attempts = 0;
const maxAttempts = 15;
while (attempts < maxAttempts) {
  const currentTitle = await page.title();
  const currentUrl = page.url();

  if (!currentTitle.includes('请稍候') &&    // Chinese "Please wait"
      !currentTitle.includes('Just a moment') &&
      !currentTitle.includes('Checking') &&
      !currentUrl.includes('challenges.cloudflare.com')) {
    break; // Challenge passed
  }

  await new Promise(resolve => setTimeout(resolve, 3000));
  attempts++;
}
```

### 5. Resource Download Through Browser

Resources (images, CSS, JS) must be downloaded through the authenticated browser session:

```typescript
export async function fetchBinaryWithBrowser(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<{ buffer: Buffer; status: number; contentType: string }> {
  const { browser } = await getBrowserPage();

  // Create new page for each resource
  const resourcePage = await browser.newPage();

  try {
    const response = await resourcePage.goto(url, {
      waitUntil: 'domcontentloaded',
    });

    if (!response) {
      return { buffer: Buffer.alloc(0), status: 0, contentType: '' };
    }

    const buffer = await response.buffer();
    return {
      buffer,
      status: response.status(),
      contentType: response.headers()['content-type'] || '',
    };
  } finally {
    await resourcePage.close();
  }
}
```

### 6. Main Flow Integration

```typescript
// In src/index.ts
if (useBrowser) {
  // First try TLS bypass (faster)
  log("Trying TLS bypass first...");
  try {
    const tlsResult = await fetchWithTlsBypass(url, { timeout, headers, userAgent });

    if (isCloudflareChallenge(tlsResult.html)) {
      log("TLS bypass blocked, switching to browser mode...");
      const browserResult = await fetchWithBrowser(url, { timeout, headers, userAgent });
      html = browserResult.html;
      finalUrl = browserResult.url;
    }
  } catch {
    log("TLS bypass failed, switching to browser mode...");
    const browserResult = await fetchWithBrowser(url, { timeout, headers, userAgent });
    html = browserResult.html;
    finalUrl = browserResult.url;
  }
}

// All resource downloads use browser fetch when browserModeUsed = true
const result = browserModeUsed
  ? await fetchBinaryWithBrowser(url, { timeout, headers })
  : await fetchBinary(url, { timeout, headers, userAgent, referer });
```

## Usage

```bash
node dist/cli.js --browser --output ./output https://appstorrent.ru/
```

### CLI Options

| Flag | Description |
|------|-------------|
| `--browser` | Enable browser mode for Cloudflare bypass |
| `--timeout <ms>` | Request timeout (default: 30000) |
| `--output <dir>` | Output directory (default: ./output) |
| `--wait-for <selector>` | Wait for selector before extracting |

## Results

### Test Case: appstorrent.ru

| Metric | Count |
|--------|-------|
| Images | 108 downloaded |
| CSS | 10 downloaded |
| JS | 23 downloaded |
| Total Size | 5.94 MB |

## Technical Stack

| Component | Package | Purpose |
|-----------|---------|---------|
| Browser Automation | `puppeteer-real-browser` | Cloudflare bypass |
| Browser Core | `rebrowser-puppeteer-core` | Modified Puppeteer |
| Mouse Simulation | `ghost-cursor` | Human-like cursor |
| HTML Parsing | `cheerio` | Resource extraction |
| HTTP Client | `undici` | Fast HTTP requests |
| HTTP Client (TLS) | `got-scraping` | TLS fingerprint spoofing |

## Limitations

1. **Visible Browser Required** - Headless mode is detected; browser window will open
2. **Slower Performance** - Each resource opens a new browser tab (can optimize with tab reuse)
3. **Memory Usage** - Chrome browser consumes ~500MB RAM
4. **Timeout Needed** - Cloudflare challenge solving takes 10-15 seconds

## Future Improvements

1. **Tab Pool** - Reuse browser tabs for parallel downloads
2. **Cookie Persistence** - Save cookies to skip challenge on subsequent runs
3. **Proxy Support** - Add proxy rotation for rate limiting
4. **Headless Mode** - Monitor CloakBrowser download fixes for true headless bypass

## Alternative Solutions Tested

| Solution | Result | Reason |
|----------|--------|--------|
| Regular Playwright | Failed | Automation detected |
| playwright-extra + stealth | Failed | Turnstile not supported |
| CloakBrowser | Failed | Binary download network issues |
| got-scraping (TLS) | Failed | Challenge page still returned |
| puppeteer-real-browser | **Success** | Built-in Turnstile solver |

## Files Modified

| File | Changes |
|------|---------|
| `src/browser-fetcher.ts` | New module with puppeteer-real-browser |
| `src/index.ts` | Browser mode integration, browser-based downloads |
| `src/cloudflare-bypass.ts` | TLS bypass attempt (fallback) |
| `package.json` | Added puppeteer-real-browser, got-scraping |