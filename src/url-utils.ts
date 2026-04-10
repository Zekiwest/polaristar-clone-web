/**
 * URL Utilities - Handles URL resolution, normalization
 * Derived from Firecrawl's extractLinks/extractImages modules
 */

/**
 * Resolve a relative URL to an absolute URL
 */
export function resolveUrl(
  href: string,
  baseUrl: string,
  baseHref: string = ""
): string {
  let resolutionBase = baseUrl;

  // Handle base href
  if (baseHref) {
    try {
      new URL(baseHref);
      resolutionBase = baseHref;
    } catch {
      try {
        resolutionBase = new URL(baseHref, baseUrl).href;
      } catch {
        resolutionBase = baseUrl;
      }
    }
  }

  try {
    // Skip data URIs and blob URLs
    if (href.startsWith("data:") || href.startsWith("blob:")) {
      return href;
    }

    // Handle absolute URLs
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return href;
    }

    // Handle protocol-relative URLs
    if (href.startsWith("//")) {
      const protocol = new URL(baseUrl).protocol;
      return protocol + href;
    }

    // Handle mailto and javascript
    if (href.startsWith("mailto:") || href.startsWith("javascript:")) {
      return "";
    }

    // Handle anchor links
    if (href.startsWith("#")) {
      return "";
    }

    // Handle relative URLs
    return new URL(href, resolutionBase).href;
  } catch (error) {
    return "";
  }
}

/**
 * Extract base href from HTML
 */
export function extractBaseHref(html: string): string {
  const match = html.match(/<base[^>]+href=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

/**
 * Check if URL is valid
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Get URL file extension
 */
export function getUrlExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Normalize URL (remove fragments, trailing slashes)
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove fragment
    parsed.hash = "";
    // Remove trailing slash from pathname
    if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Check if two URLs are from the same origin
 */
export function sameOrigin(url1: string, url2: string): boolean {
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);
    return u1.origin === u2.origin;
  } catch {
    return false;
  }
}

/**
 * Get URL filename
 */
export function getUrlFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}