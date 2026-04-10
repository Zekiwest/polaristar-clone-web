/**
 * Fetcher - Handles HTTP requests with proper headers
 * Derived from Firecrawl's fetch engine
 */

import * as undici from "undici";

export interface FetchOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Follow redirects */
  followRedirects?: boolean;
  /** User agent */
  userAgent?: string;
  /** Referer header */
  referer?: string;
}

export interface FetchResult {
  /** Final URL (after redirects) */
  url: string;
  /** Response body as string */
  body: string;
  /** Response body as Buffer */
  buffer: Buffer;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Content type */
  contentType: string;
}

/**
 * Default user agent
 */
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Default browser headers for better compatibility
 */
const DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "max-age=0",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * Fetch a URL with proper headers and options
 */
export async function fetchUrl(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const {
    timeout = 30000,
    headers = {},
    followRedirects = true,
    userAgent = DEFAULT_USER_AGENT,
    referer,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await undici.fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: followRedirects ? "follow" : "manual",
      headers: {
        ...DEFAULT_HEADERS,
        "User-Agent": userAgent,
        ...(referer ? { Referer: referer } : {}),
        ...headers,
      },
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const body = buffer.toString("utf-8");

    // Convert headers to object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      url: response.url,
      body,
      buffer,
      status: response.status,
      headers: responseHeaders,
      contentType: responseHeaders["content-type"] || "",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a binary file (image, CSS, JS, etc.)
 */
export async function fetchBinary(
  url: string,
  options: FetchOptions = {}
): Promise<{ buffer: Buffer; status: number; contentType: string }> {
  const {
    timeout = 30000,
    headers = {},
    userAgent = DEFAULT_USER_AGENT,
    referer,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await undici.fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        ...(referer ? { Referer: referer } : {}),
        ...headers,
      },
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";

    return {
      buffer,
      status: response.status,
      contentType,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if URL is accessible
 */
export async function checkUrl(
  url: string,
  options: FetchOptions = {}
): Promise<{ accessible: boolean; status: number; contentType: string }> {
  const { timeout = 10000, userAgent = DEFAULT_USER_AGENT, referer } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await undici.fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        ...(referer ? { Referer: referer } : {}),
      },
    });

    return {
      accessible: response.status >= 200 && response.status < 400,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
    };
  } catch {
    return {
      accessible: false,
      status: 0,
      contentType: "",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}