/**
 * Cloudflare Bypass - Uses got-scraping for TLS fingerprint spoofing
 * Handles Cloudflare Turnstile and other bot protections
 */

// Use dynamic import for ESM module compatibility
let gotScrapingFunc: typeof import("got-scraping").gotScraping | null = null;

async function getGotScraping() {
  if (!gotScrapingFunc) {
    const gotScrapingModule = await import("got-scraping");
    gotScrapingFunc = gotScrapingModule.gotScraping;
  }
  return gotScrapingFunc;
}

export interface CloudflareBypassOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** User agent */
  userAgent?: string;
  /** Proxy URL */
  proxy?: string;
}

export interface CloudflareBypassResult {
  /** Final URL (after redirects) */
  url: string;
  /** HTML content */
  html: string;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
}

/**
 * Fetch a URL with TLS fingerprint spoofing to bypass Cloudflare
 */
export async function fetchWithTlsBypass(
  url: string,
  options: CloudflareBypassOptions = {}
): Promise<CloudflareBypassResult> {
  const {
    timeout = 30000,
    headers = {},
    userAgent,
    proxy,
  } = options;

  const gotScraping = await getGotScraping();

  const response = await gotScraping({
    url,
    method: 'GET',
    timeout: {
      request: timeout,
    },
    headers: {
      'User-Agent': userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      ...headers,
    },
    // Use Chrome TLS fingerprint
    headerGeneratorOptions: {
      browsers: ['chrome'],
      devices: ['desktop'],
      operatingSystems: ['macos'],
    },
    context: {
      proxy,
    },
  });

  return {
    url: response.url,
    html: response.body,
    status: response.statusCode,
    headers: response.headers as Record<string, string>,
  };
}

/**
 * Check if HTML is a Cloudflare challenge page
 */
export function isCloudflareChallenge(html: string): boolean {
  return html.includes('challenge-platform') ||
         html.includes('__cf_chl_opt') ||
         html.includes('Just a moment') ||
         html.includes('Checking your browser');
}