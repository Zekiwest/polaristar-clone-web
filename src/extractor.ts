/**
 * Resource Extractor - Extracts CSS, JS, images from HTML
 * Derived from Firecrawl's extractImages/extractLinks modules
 */

import * as cheerio from "cheerio";
import {
  resolveUrl,
  extractBaseHref,
  isValidUrl,
  getUrlExtension,
} from "./url-utils.js";

export interface ExtractedResources {
  /** Image URLs */
  images: string[];
  /** CSS URLs */
  css: string[];
  /** JavaScript URLs */
  javascript: string[];
  /** All links (href attributes) */
  links: string[];
  /** Favicon URL */
  favicon: string | null;
  /** Meta images (og:image, twitter:image) */
  metaImages: string[];
  /** Font URLs from preload/prefetch */
  fonts: string[];
}

/**
 * Extract all resources from HTML content
 */
export function extractResources(html: string, baseUrl: string): ExtractedResources {
  const $ = cheerio.load(html);
  const baseHref = extractBaseHref(html);

  const images = new Set<string>();
  const css = new Set<string>();
  const javascript = new Set<string>();
  const links = new Set<string>();
  let favicon: string | null = null;
  const metaImages = new Set<string>();
  const fonts = new Set<string>();

  // Helper to add resolved URL
  const addUrl = (url: string, set: Set<string>) => {
    // Handle Next.js image optimizer URLs: /_next/image?url=<encoded_url>&w=...
    const nextImageUrl = extractNextJsImageUrl(url, baseUrl);
    if (nextImageUrl) {
      set.add(nextImageUrl);
      return;
    }

    const resolved = resolveUrl(url.trim(), baseUrl, baseHref);
    if (resolved && isValidUrl(resolved)) {
      set.add(resolved);
    }
  };

  /**
   * Extract real URL from Next.js image optimizer URL
   * Format: /_next/image?url=<encoded_url>&w=<width>&q=<quality>
   */
  function extractNextJsImageUrl(url: string, base: string): string | null {
    try {
      // Check if it's a Next.js image URL
      if (!url.includes("/_next/image") && !url.includes("%2F_next%2Fimage")) {
        return null;
      }

      // Resolve the URL first
      let fullUrl = url;
      if (!url.startsWith("http")) {
        fullUrl = new URL(url, base).href;
      }

      // Parse the URL and extract the 'url' parameter
      const urlObj = new URL(fullUrl);
      const encodedUrl = urlObj.searchParams.get("url");

      if (encodedUrl) {
        // Decode the URL
        const decodedUrl = decodeURIComponent(encodedUrl);
        if (isValidUrl(decodedUrl)) {
          return decodedUrl;
        }
      }
    } catch {
      // Ignore parsing errors
    }
    return null;
  }

  // =====================
  // Extract Images
  // =====================

  // From <img> tags
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) addUrl(src, images);

    // Lazy-loaded images
    const dataSrc = $(el).attr("data-src");
    if (dataSrc) addUrl(dataSrc, images);

    // srcset for responsive images
    const srcset = $(el).attr("srcset");
    if (srcset) {
      srcset.split(",").forEach((item) => {
        const url = item.trim().split(/\s+/)[0];
        if (url) addUrl(url, images);
      });
    }
  });

  // From <picture> elements
  $("picture source").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (srcset) {
      srcset.split(",").forEach((item) => {
        const url = item.trim().split(/\s+/)[0];
        if (url) addUrl(url, images);
      });
    }
  });

  // From video poster
  $("video[poster]").each((_, el) => {
    const poster = $(el).attr("poster");
    if (poster) addUrl(poster, images);
  });

  // Background images in inline styles
  $("[style*='background']").each((_, el) => {
    const style = $(el).attr("style") || "";
    const matches = style.match(/url\(['"]?([^'")]+)['"]?\)/gi);
    if (matches) {
      matches.forEach((match) => {
        const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
        if (urlMatch?.[1]) {
          const url = urlMatch[1].trim();
          // Skip CSS files
          if (url.endsWith('.css') || url.includes('.css?')) return;
          // Skip fragment-only URLs
          if (url.startsWith('#') || url.startsWith('%23')) return;
          addUrl(url, images);
        }
      });
    }
  });

  // =====================
  // Extract CSS
  // =====================

  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) addUrl(href, css);
  });

  // Also check for <style> @import
  $("style").each((_, el) => {
    const content = $(el).html() || "";
    const importMatches = content.match(/@import\s+url\(['"]?([^'")]+)['"]?\)/gi);
    if (importMatches) {
      importMatches.forEach((match) => {
        const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
        if (urlMatch?.[1]) addUrl(urlMatch[1], css);
      });
    }
  });

  // =====================
  // Extract JavaScript
  // =====================

  $('script[src]').each((_, el) => {
    const src = $(el).attr("src");
    if (src) addUrl(src, javascript);
  });

  // =====================
  // Extract Links
  // =====================

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const resolved = resolveUrl(href.trim(), baseUrl, baseHref);
      if (resolved && isValidUrl(resolved)) {
        links.add(resolved);
      }
    }
  });

  // =====================
  // Extract Favicon
  // =====================

  $('link[rel*="icon"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && !favicon) {
      const resolved = resolveUrl(href.trim(), baseUrl, baseHref);
      if (resolved && isValidUrl(resolved)) {
        favicon = resolved;
      }
    }
  });

  // =====================
  // Extract Preload Fonts
  // =====================

  $('link[rel="preload"][as="font"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const resolved = resolveUrl(href.trim(), baseUrl, baseHref);
      if (resolved && isValidUrl(resolved)) {
        fonts.add(resolved);
      }
    }
  });

  // Also extract Next.js static media fonts from link preload
  $('link[rel="preload"][href*="/_next/static/media/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.includes("/_next/static/media/")) {
      const resolved = resolveUrl(href.trim(), baseUrl, baseHref);
      if (resolved && isValidUrl(resolved)) {
        fonts.add(resolved);
      }
    }
  });

  // =====================
  // Extract Meta Images
  // =====================

  const metaImageSelectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
  ];

  metaImageSelectors.forEach((selector) => {
    const content = $(selector).attr("content");
    if (content) addUrl(content, metaImages);
  });

  // Also check link[rel="image_src"]
  $('link[rel="image_src"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) addUrl(href, metaImages);
  });

  return {
    images: Array.from(images),
    css: Array.from(css),
    javascript: Array.from(javascript),
    links: Array.from(links),
    favicon,
    metaImages: Array.from(metaImages),
    fonts: Array.from(fonts),
  };
}

/**
 * Extract CSS resources (images, fonts) from CSS content
 */
export function extractCssResources(cssContent: string, baseUrl: string): {
  images: string[];
  fonts: string[];
} {
  const images = new Set<string>();
  const fonts = new Set<string>();

  // Match url() in CSS
  const urlMatches = cssContent.match(/url\(['"]?[^'")]+['"]?\)/gi) || [];

  urlMatches.forEach((match) => {
    const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
    if (urlMatch?.[1]) {
      let url = urlMatch[1].trim();

      // Skip data URIs
      if (url.startsWith("data:")) return;

      // Skip CSS files (sometimes CSS files are referenced in url())
      if (url.endsWith('.css') || url.includes('.css?')) return;

      // Skip fragment-only URLs (SVG filter references like #id or %23id)
      if (url.startsWith('#') || url.startsWith('%23')) return;

      // Resolve relative URLs
      try {
        if (!url.startsWith("http")) {
          url = new URL(url, baseUrl).href;
        }
      } catch {
        return;
      }

      // Determine if it's an image or font
      const ext = getUrlExtension(url).toLowerCase();
      const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"];
      const fontExts = ["woff", "woff2", "ttf", "otf", "eot"];

      if (imageExts.includes(ext) || url.includes("image")) {
        images.add(url);
      } else if (fontExts.includes(ext) || url.includes("font")) {
        fonts.add(url);
      } else {
        // Default to image for unknown types
        images.add(url);
      }
    }
  });

  return {
    images: Array.from(images),
    fonts: Array.from(fonts),
  };
}