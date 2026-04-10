/**
 * Real Browser Fetcher - Uses puppeteer-real-browser for Cloudflare bypass
 * Handles Cloudflare Turnstile and other bot protections
 */

import type { Browser, Page } from "rebrowser-puppeteer-core";

export interface BrowserFetchOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Wait for selector before extracting content */
  waitForSelector?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** User agent */
  userAgent?: string;
  /** Proxy URL */
  proxy?: string;
}

export interface BrowserFetchResult {
  /** Final URL (after redirects) */
  url: string;
  /** HTML content */
  html: string;
  /** HTTP status code */
  status: number;
  /** Page title */
  title: string;
  /** Cookies */
  cookies: Array<{ name: string; value: string; domain: string }>;
}

let browser: Browser | null = null;
let page: Page | null = null;
let connectFunc: ((options: import("puppeteer-real-browser").Options) => Promise<import("puppeteer-real-browser").ConnectResult>) | null = null;

/**
 * Get or create browser instance using puppeteer-real-browser
 */
async function getBrowserPage(): Promise<{ browser: Browser; page: Page }> {
  if (!browser || !page) {
    console.log('  Launching real browser (puppeteer-real-browser)...');

    // Use dynamic import for ESM module compatibility
    if (!connectFunc) {
      const puppeteerRealBrowser = await import('puppeteer-real-browser');
      connectFunc = puppeteerRealBrowser.connect;
    }

    const result = await connectFunc({
      headless: false, // Use visible browser for better Cloudflare bypass
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
      connectOption: {
        defaultViewport: {
          width: 1920,
          height: 1080,
        },
      },
      turnstile: true, // Enable Cloudflare Turnstile solving
    });

    browser = result.browser;
    page = result.page;
  }

  return { browser, page };
}

/**
 * Close browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

/**
 * Fetch a URL using a real browser with Cloudflare bypass
 */
export async function fetchWithBrowser(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<BrowserFetchResult> {
  const {
    timeout = 60000,
    waitForSelector,
    headers = {},
  } = options;

  const { page } = await getBrowserPage();

  // Set timeout
  page.setDefaultTimeout(timeout);

  // Set custom headers if provided
  if (Object.keys(headers).length > 0) {
    await page.setExtraHTTPHeaders(headers);
  }

  // Navigate to URL
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout,
  });

  if (!response) {
    throw new Error('No response received');
  }

  // Wait for specific selector if provided
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout });
  }

  // Wait for Cloudflare challenge to be solved (if present)
  // The puppeteer-real-browser with turnstile should handle this
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Check if still on challenge page and wait more
  let attempts = 0;
  const maxAttempts = 15;
  while (attempts < maxAttempts) {
    const currentTitle = await page.title();
    const currentUrl = page.url();

    // Check if we're still on a Cloudflare challenge
    if (!currentTitle.includes('请稍候') &&
        !currentTitle.includes('Just a moment') &&
        !currentTitle.includes('Checking') &&
        !currentUrl.includes('challenges.cloudflare.com')) {
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
    attempts++;
    if (attempts % 3 === 0) {
      console.log(`  Still waiting for Cloudflare... (${attempts}/${maxAttempts})`);
    }
  }

  // Get final URL
  const finalUrl = page.url();

  // Get HTML content
  const html = await page.content();

  // Get title
  const title = await page.title();

  // Get cookies
  const cookies = await page.cookies();

  // Get status
  const status = response.status();

  return {
    url: finalUrl,
    html,
    status,
    title,
    cookies: cookies.map((c: { name: string; value: string; domain: string }) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
    })),
  };
}

/**
 * Fetch multiple pages using the same browser context
 */
export async function fetchMultipleWithBrowser(
  urls: string[],
  options: BrowserFetchOptions = {}
): Promise<BrowserFetchResult[]> {
  const results: BrowserFetchResult[] = [];

  for (const url of urls) {
    try {
      const result = await fetchWithBrowser(url, options);
      results.push(result);
    } catch (error) {
      console.error(`Failed to fetch ${url}:`, error);
    }
  }

  return results;
}

/**
 * Fetch a binary resource (image, CSS, JS) through the browser
 * This bypasses Cloudflare by using the browser's authenticated session
 */
export async function fetchBinaryWithBrowser(
  url: string,
  options: BrowserFetchOptions = {}
): Promise<{ buffer: Buffer; status: number; contentType: string }> {
  const { timeout = 30000 } = options;

  const { page, browser } = await getBrowserPage();

  // Create a new page for fetching binary content
  const resourcePage = await browser.newPage();
  resourcePage.setDefaultTimeout(timeout);

  try {
    const response = await resourcePage.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout,
    });

    if (!response) {
      return { buffer: Buffer.alloc(0), status: 0, contentType: '' };
    }

    const buffer = await response.buffer();
    const contentType = response.headers()['content-type'] || '';

    return {
      buffer,
      status: response.status(),
      contentType,
    };
  } catch (error) {
    return { buffer: Buffer.alloc(0), status: 0, contentType: '' };
  } finally {
    await resourcePage.close();
  }
}

/**
 * Get the current browser page for reuse
 */
export function getActivePage(): Page | null {
  return page;
}