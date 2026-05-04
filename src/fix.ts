/**
 * Fix Module - Resource link repair
 * Fixes broken links, CDN URLs, and font references
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 修复已下载文件中的链接、CDN URL、字体引用
 * 依赖关系: cheerio
 * 变更同步: 修改修复策略时更新 PROJECT_INDEX.md 命令表和 src/_dir.md
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

export interface FixOptions {
  /** Fix internal links (absolute to relative) */
  fixLinks?: boolean;
  /** Fix CDN URLs */
  fixCdn?: boolean;
  /** Fix font URLs */
  fixFonts?: boolean;
  /** Original base URL (for link fixing) */
  baseUrl?: string;
  /** External domains to keep as-is */
  externalDomains?: string[];
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export interface FixResult {
  /** Files processed */
  filesProcessed: number;
  /** Files changed */
  filesChanged: number;
  /** Total replacements */
  totalReplacements: number;
  /** Link replacements */
  linkReplacements: number;
  /** CDN replacements */
  cdnReplacements: number;
  /** Font replacements */
  fontReplacements: number;
}

/**
 * Default external domains to keep as-is
 */
const DEFAULT_EXTERNAL_DOMAINS = [
  "google",
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "youtube",
  "tiktok",
  "pinterest",
  "github",
  "shopify.com",
  "cdn.shopify.com",
  "sanity.io",
  "klaviyo.com",
  "vercel",
  "sentry",
  "cloudflare",
  "amazonaws",
  "googleapis",
  "googletagmanager",
  "googleanalytics",
];

/**
 * Check if URL is external
 */
function isExternal(url: string, externalDomains: string[]): boolean {
  return externalDomains.some(domain => url.toLowerCase().includes(domain.toLowerCase()));
}

/**
 * Collect HTML files from directory
 */
function collectHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectHtmlFiles(full));
    } else if (entry.name.endsWith(".html") || entry.name.endsWith(".htm")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Fix a single HTML file
 */
function fixHtmlFile(
  filePath: string,
  options: FixOptions
): { changed: boolean; replacements: number; links: number; cdn: number; fonts: number } {
  if (!fs.existsSync(filePath)) {
    return { changed: false, replacements: 0, links: 0, cdn: 0, fonts: 0 };
  }

  let html = fs.readFileSync(filePath, "utf-8");
  const $ = cheerio.load(html);
  let replacements = 0;
  let linkReplacements = 0;
  let cdnReplacements = 0;
  let fontReplacements = 0;

  const externalDomains = options.externalDomains || DEFAULT_EXTERNAL_DOMAINS;
  const baseUrl = options.baseUrl;

  // Fix href attributes
  if (options.fixLinks && baseUrl) {
    const baseOrigin = new URL(baseUrl).origin;

    $("a[href], link[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      // Skip external links
      if (isExternal(href, externalDomains)) return;
      if (!href.startsWith("http")) return;
      if (!href.startsWith(baseOrigin) && !href.includes(baseUrl.replace("https://", "").replace("http://", ""))) return;

      // Convert to relative path
      try {
        const parsed = new URL(href);
        const pathname = parsed.pathname;
        if (pathname && pathname !== "/") {
          $(el).attr("href", pathname);
          replacements++;
          linkReplacements++;
        }
      } catch { /* skip invalid URLs */ }
    });

    // Also fix inline URLs in href="..." patterns
    const inlineHrefRegex = /href="(https?:\/\/[^"]*)"/g;
    html = $.html();
    html = html.replace(inlineHrefRegex, (match, url) => {
      if (isExternal(url, externalDomains)) return match;
      if (!url.includes(baseUrl.replace("https://", "").replace("http://", "").split("/")[0])) return match;

      try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        if (pathname && pathname !== "/") {
          replacements++;
          linkReplacements++;
          return `href="${pathname}"`;
        }
      } catch { /* skip */ }
      return match;
    });
  }

  // Fix src attributes
  if (options.fixLinks && baseUrl) {
    const baseOrigin = new URL(baseUrl).origin;

    $("script[src], img[src], video[src], source[src], iframe[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (!src) return;

      if (isExternal(src, externalDomains)) return;
      if (!src.startsWith("http")) return;
      if (!src.startsWith(baseOrigin) && !src.includes(baseUrl.replace("https://", "").replace("http://", "").split("/")[0])) return;

      try {
        const parsed = new URL(src);
        const pathname = parsed.pathname;
        if (pathname && pathname !== "/") {
          $(el).attr("src", pathname);
          replacements++;
          linkReplacements++;
        }
      } catch { /* skip */ }
    });
  }

  // Fix CDN URLs
  if (options.fixCdn) {
    // Common CDN patterns
    const cdnPatterns = [
      /https?:\/\/cdn\.shopify\.com\/s\/files\/[^"'\s]+/gi,
      /https?:\/\/cdn\.sanity\.io\/[^"'\s]+/gi,
      /https?:\/\/[a-z0-9-]+\.cloudfront\.net\/[^"'\s]+/gi,
      /https?:\/\/[a-z0-9-]+\.cdn\.amazonaws\.com\/[^"'\s]+/gi,
    ];

    html = $.html();
    for (const pattern of cdnPatterns) {
      html = html.replace(pattern, (match) => {
        // Extract filename from URL
        try {
          const url = new URL(match.split('"')[0].split("'")[0].split(" ")[0]);
          const pathname = url.pathname;
          const filename = pathname.split("/").pop() || "";

          // Check if file exists locally
          const localPaths = [
            path.join(path.dirname(filePath), "images", filename),
            path.join(path.dirname(filePath), "images", "cdn", filename),
            path.join(path.dirname(filePath), "fonts", filename),
          ];

          for (const localPath of localPaths) {
            if (fs.existsSync(localPath)) {
              const relativeDir = path.basename(path.dirname(localPath));
              replacements++;
              cdnReplacements++;
              return `/${relativeDir}/${filename}`;
            }
          }
        } catch { /* skip */ }
        return match;
      });
    }
  }

  // Fix font URLs
  if (options.fixFonts) {
    const fontPatterns = [
      /https?:\/\/[^\s"'<>]+\.woff2?/gi,
      /https?:\/\/[^\s"'<>]+\.ttf/gi,
      /https?:\/\/[^\s"'<>]+\.otf/gi,
    ];

    html = $.html();
    for (const pattern of fontPatterns) {
      html = html.replace(pattern, (match) => {
        // Clean the URL
        const cleanUrl = match.replace(/[;,\).\!]+$/, "").split('"')[0].split("'")[0].split(" ")[0];

        try {
          const url = new URL(cleanUrl);
          const filename = url.pathname.split("/").pop() || "";

          // Check if font exists locally
          const fontsDir = path.join(path.dirname(filePath), "fonts");
          const localPath = path.join(fontsDir, filename);

          if (fs.existsSync(localPath)) {
            replacements++;
            fontReplacements++;
            return `/fonts/${filename}`;
          }
        } catch { /* skip */ }
        return match;
      });
    }
  }

  const changed = replacements > 0;
  if (changed) {
    fs.writeFileSync(filePath, html, "utf-8");
  }

  return { changed, replacements, links: linkReplacements, cdn: cdnReplacements, fonts: fontReplacements };
}

/**
 * Fix all HTML files in a directory
 */
export function fixDirectory(
  outputDir: string,
  options: FixOptions = {}
): FixResult {
  const log = (msg: string) => options.onProgress?.(msg);

  log(`Fixing files in: ${outputDir}`);

  const htmlFiles = collectHtmlFiles(outputDir);
  log(`Found ${htmlFiles.length} HTML files`);

  let filesChanged = 0;
  let totalReplacements = 0;
  let linkReplacements = 0;
  let cdnReplacements = 0;
  let fontReplacements = 0;

  for (const file of htmlFiles) {
    const relativePath = path.relative(outputDir, file);
    const result = fixHtmlFile(file, options);

    if (result.changed) {
      filesChanged++;
      totalReplacements += result.replacements;
      linkReplacements += result.links;
      cdnReplacements += result.cdn;
      fontReplacements += result.fonts;
      log(`  Fixed ${result.replacements} in ${relativePath}`);
    }
  }

  log(`\nFiles changed: ${filesChanged}/${htmlFiles.length}`);
  log(`Total replacements: ${totalReplacements}`);

  return {
    filesProcessed: htmlFiles.length,
    filesChanged,
    totalReplacements,
    linkReplacements,
    cdnReplacements,
    fontReplacements,
  };
}