/**
 * Path Rewriter - Rewrites resource paths in HTML and CSS for local viewing
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 将 HTML/CSS 中的 URL 重写为本地路径
 * 依赖关系: cheerio, url-utils.ts
 * 变更同步: 修改重写逻辑时更新 src/_dir.md 模块清单
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as cheerio from "cheerio";
import { getUrlExtension } from "./url-utils.js";

export interface RewriteResult {
  /** Rewritten HTML content */
  html: string;
  /** URL to local filename mapping */
  urlMap: Map<string, string>;
}

/**
 * Rewrite HTML to use local resource paths
 */
export function rewriteHtml(
  html: string,
  baseUrl: string,
  downloadedImages: Set<string>,
  downloadedCss: Set<string>,
  downloadedJs: Set<string>,
  downloadedFonts: Set<string> = new Set()
): string {
  const $ = cheerio.load(html);
  const urlMap = buildUrlMap(
    downloadedImages,
    downloadedCss,
    downloadedJs
  );
  const fontMap = buildUrlMap(downloadedFonts, new Set(), new Set(), "fonts");

  // Rewrite CSS links
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const localPath = findLocalPath(href, baseUrl, urlMap, "css");
      if (localPath) {
        $(el).attr("href", localPath);
      }
    }
  });

  // Rewrite preload CSS links (Next.js uses <link rel="preload" as="style">)
  $('link[rel="preload"][as="style"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const localPath = findLocalPath(href, baseUrl, urlMap, "css");
      if (localPath) {
        $(el).attr("href", localPath);
      }
    }
  });

  // Rewrite preload JS links (Next.js uses <link rel="modulepreload">)
  $('link[rel="modulepreload"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const localPath = findLocalPath(href, baseUrl, urlMap, "js");
      if (localPath) {
        $(el).attr("href", localPath);
      }
    }
  });

  // Rewrite preload font links
  $('link[rel="preload"][as="font"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const localPath = findLocalPath(href, baseUrl, fontMap, "fonts");
      if (localPath) {
        $(el).attr("href", localPath);
      }
    }
  });

  // Rewrite JS sources
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      const localPath = findLocalPath(src, baseUrl, urlMap, "js");
      if (localPath) {
        $(el).attr("src", localPath);
      }
    }
  });

  // Rewrite image sources
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      const localPath = findLocalPath(src, baseUrl, urlMap, "images");
      if (localPath) {
        $(el).attr("src", localPath);
      }
    }

    // Also handle data-src for lazy loading
    const dataSrc = $(el).attr("data-src");
    if (dataSrc) {
      const localPath = findLocalPath(dataSrc, baseUrl, urlMap, "images");
      if (localPath) {
        $(el).attr("data-src", localPath);
      }
    }

    // Handle srcset
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const newSrcset = rewriteSrcset(srcset, baseUrl, urlMap);
      if (newSrcset !== srcset) {
        $(el).attr("srcset", newSrcset);
      }
    }
  });

  // Rewrite preload image link imagesrcset (Next.js specific)
  $('link[rel="preload"][as="image"]').each((_, el) => {
    const imagesrcset = $(el).attr("imagesrcset");
    if (imagesrcset) {
      const newImagesrcset = rewriteSrcset(imagesrcset, baseUrl, urlMap);
      if (newImagesrcset !== imagesrcset) {
        $(el).attr("imagesrcset", newImagesrcset);
      }
    }
  });

  // Rewrite picture source srcset
  $("picture source").each((_, el) => {
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const newSrcset = rewriteSrcset(srcset, baseUrl, urlMap);
      if (newSrcset !== srcset) {
        $(el).attr("srcset", newSrcset);
      }
    }
  });

  // Rewrite inline background images
  $("[style*='background']").each((_, el) => {
    const style = $(el).attr("style") || "";
    const newStyle = rewriteInlineStyles(style, baseUrl, urlMap);
    if (newStyle !== style) {
      $(el).attr("style", newStyle);
    }
  });

  // Rewrite video poster
  $("video[poster]").each((_, el) => {
    const poster = $(el).attr("poster");
    if (poster) {
      const localPath = findLocalPath(poster, baseUrl, urlMap, "images");
      if (localPath) {
        $(el).attr("poster", localPath);
      }
    }
  });

  // Rewrite favicon
  $('link[rel*="icon"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href && !href.startsWith("data:")) {
      const localPath = findLocalPath(href, baseUrl, urlMap, "images");
      if (localPath) {
        $(el).attr("href", localPath);
      }
    }
  });

  return $.html();
}

/**
 * Rewrite CSS content to use local resource paths
 * @param cssFilePath - Path to the CSS file (for generating correct relative paths)
 */
export function rewriteCss(
  cssContent: string,
  baseUrl: string,
  downloadedImages: Set<string>,
  downloadedFonts: Set<string> = new Set(),
  cssFilePath?: string
): string {
  const urlMap = buildUrlMap(downloadedImages, new Set(), new Set());
  const fontMap = buildUrlMap(downloadedFonts, new Set(), new Set(), "fonts");

  // Determine relative prefix based on CSS file location
  const relPrefix = cssFilePath ? "../" : "";

  // Match url() patterns
  return cssContent.replace(/url\(['"]?([^'")\s]+)['"]?\)/gi, (match, url) => {
    // Skip data URIs
    if (url.startsWith("data:")) {
      return match;
    }

    // Resolve URL
    let resolvedUrl = url;
    try {
      if (!url.startsWith("http")) {
        resolvedUrl = new URL(url, baseUrl).href;
      }
    } catch {
      return match;
    }

    // Check if it's a font
    const fontPath = findLocalPath(resolvedUrl, baseUrl, fontMap, "fonts");
    if (fontPath) {
      return `url(${relPrefix}${fontPath})`;
    }

    // Check if it's an image
    const localPath = findLocalPath(resolvedUrl, baseUrl, urlMap, "images");
    if (localPath) {
      return `url(${relPrefix}${localPath})`;
    }

    return match;
  });
}

/**
 * Build a map from URLs to local filenames
 */
function buildUrlMap(
  images: Set<string>,
  css: Set<string>,
  js: Set<string>,
  imagesType: string = "images"
): Map<string, { filename: string; type: string }> {
  const map = new Map<string, { filename: string; type: string }>();

  images.forEach((url) => {
    const filename = getFilenameFromUrl(url);
    if (filename) {
      map.set(url, { filename, type: imagesType });
      map.set(normalizeUrlForMatch(url), { filename, type: imagesType });
    }
  });

  css.forEach((url) => {
    const filename = getFilenameFromUrl(url);
    if (filename) {
      map.set(url, { filename, type: "css" });
      map.set(normalizeUrlForMatch(url), { filename, type: "css" });
    }
  });

  js.forEach((url) => {
    const filename = getFilenameFromUrl(url);
    if (filename) {
      map.set(url, { filename, type: "js" });
      map.set(normalizeUrlForMatch(url), { filename, type: "js" });
    }
  });

  return map;
}

/**
 * Find local path for a URL
 */
function findLocalPath(
  url: string,
  baseUrl: string,
  urlMap: Map<string, { filename: string; type: string }>,
  defaultType: string
): string | null {
  // Skip data URIs, anchors, javascript:
  if (
    url.startsWith("data:") ||
    url.startsWith("#") ||
    url.startsWith("javascript:")
  ) {
    return null;
  }

  // Handle Next.js image optimizer URLs
  const nextJsRealUrl = extractNextJsImageUrl(url, baseUrl);
  if (nextJsRealUrl) {
    // Extract filename from the real URL and match
    const filename = getFilenameFromUrl(nextJsRealUrl);
    if (filename) {
      for (const [_, info] of urlMap) {
        if (info.filename === filename) {
          return `${info.type}/${info.filename}`;
        }
      }
    }
    return null;
  }

  // Resolve URL
  let resolvedUrl = url;
  try {
    if (!url.startsWith("http") && !url.startsWith("//")) {
      resolvedUrl = new URL(url, baseUrl).href;
    } else if (url.startsWith("//")) {
      resolvedUrl = "https:" + url;
    }
  } catch {
    return null;
  }

  // Check for exact match
  const exact = urlMap.get(resolvedUrl);
  if (exact) {
    return `${exact.type}/${exact.filename}`;
  }

  // Check normalized URL
  const normalized = normalizeUrlForMatch(resolvedUrl);
  const normalizedMatch = urlMap.get(normalized);
  if (normalizedMatch) {
    return `${normalizedMatch.type}/${normalizedMatch.filename}`;
  }

  // Try matching by filename
  const filename = getFilenameFromUrl(resolvedUrl);
  if (filename) {
    for (const [_, info] of urlMap) {
      if (info.filename === filename) {
        return `${info.type}/${info.filename}`;
      }
    }
  }

  return null;
}

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
      return decodeURIComponent(encodedUrl);
    }
  } catch {
    // Ignore parsing errors
  }
  return null;
}

/**
 * Get filename from URL
 */
function getFilenameFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    let filename = urlObj.pathname.split("/").pop() || "";

    // Remove query string
    filename = filename.split("?")[0];

    // Decode
    try {
      filename = decodeURIComponent(filename);
    } catch {
      // Keep encoded
    }

    // Sanitize
    filename = filename.replace(/[<>:"/\\|?*]/g, "_");

    return filename || null;
  } catch {
    return null;
  }
}

/**
 * Normalize URL for matching (remove protocol, www, query params)
 */
function normalizeUrlForMatch(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove protocol and www
    let normalized = urlObj.hostname.replace(/^www\./, "") + urlObj.pathname;
    // Remove trailing slash
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Rewrite srcset attribute
 */
function rewriteSrcset(
  srcset: string,
  baseUrl: string,
  urlMap: Map<string, { filename: string; type: string }>
): string {
  return srcset
    .split(",")
    .map((item) => {
      const parts = item.trim().split(/\s+/);
      const url = parts[0];
      const descriptor = parts.slice(1).join(" ");

      // Decode HTML entities (like &amp; to &) for Next.js image URLs
      const decodedUrl = decodeHtmlEntities(url);
      const localPath = findLocalPath(decodedUrl, baseUrl, urlMap, "images");
      if (localPath) {
        return descriptor ? `${localPath} ${descriptor}` : localPath;
      }

      // Fallback: strip Next.js query-like params (&w=&q=) from path and try again
      const cleanedUrl = decodedUrl.replace(/[&?]w=\d+&?q=\d*$/g, "").replace(/[&?]w=\d+/g, "");
      if (cleanedUrl !== decodedUrl) {
        const cleanedPath = findLocalPath(cleanedUrl, baseUrl, urlMap, "images");
        if (cleanedPath) {
          return descriptor ? `${cleanedPath} ${descriptor}` : cleanedPath;
        }
      }

      return item;
    })
    .join(", ");
}

/**
 * Decode HTML entities in URLs (e.g., &amp; -> &)
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Rewrite inline styles with background images
 */
function rewriteInlineStyles(
  style: string,
  baseUrl: string,
  urlMap: Map<string, { filename: string; type: string }>
): string {
  return style.replace(
    /url\(['"]?([^'")\s]+)['"]?\)/gi,
    (match, url) => {
      if (url.startsWith("data:")) {
        return match;
      }

      const localPath = findLocalPath(url, baseUrl, urlMap, "images");
      if (localPath) {
        return `url(${localPath})`;
      }
      return match;
    }
  );
}