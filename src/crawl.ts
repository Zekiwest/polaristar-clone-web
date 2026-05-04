/**
 * Crawl Module - Site-wide page collection
 * Extracts internal links and downloads multiple pages
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 多页网站爬取，提取内部链接并批量下载
 * 依赖关系: puppeteer-real-browser, cheerio, index.ts
 * 变更同步: 修改爬取策略时更新 PROJECT_INDEX.md 命令表和 src/_dir.md
 * ──────────────────────────────────────────────────────────────────────────
 */

import { connect } from "puppeteer-real-browser";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { collectResources } from "./index.js";

export interface CrawlOptions {
  /** Output directory */
  outputDir: string;
  /** Maximum crawl depth */
  maxDepth?: number;
  /** Maximum pages to download */
  maxPages?: number;
  /** Patterns to include (regex strings) */
  includePatterns?: string[];
  /** Patterns to exclude (regex strings) */
  excludePatterns?: string[];
  /** Use browser mode */
  useBrowser?: boolean;
  /** Request timeout */
  timeout?: number;
  /** Wait time after page load */
  waitTime?: number;
  /** Progress callback */
  onProgress?: (message: string) => void;
  /** Download assets for each page */
  downloadAssets?: boolean;
}

export interface CrawlResult {
  /** Base URL */
  baseUrl: string;
  /** Pages downloaded */
  pages: string[];
  /** Failed pages */
  failed: string[];
  /** Total resources downloaded */
  totalAssets: number;
  /** Total size */
  totalSize: number;
}

/**
 * Extract internal links from HTML
 */
function extractInternalLinks(html: string, baseUrl: string): Set<string> {
  const links = new Set<string>();
  const $ = cheerio.load(html);
  const baseOrigin = new URL(baseUrl).origin;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Skip external links, mailto, tel, anchors
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#") || href === "") return;
    if (href.startsWith("http") && !href.startsWith(baseOrigin)) return;
    if (href.startsWith("//") && !href.includes(baseOrigin.replace("https://", "").replace("http://", ""))) return;

    // Normalize to absolute URL
    let fullUrl: string;
    if (href.startsWith("/")) {
      fullUrl = baseOrigin + href;
    } else if (href.startsWith("http")) {
      fullUrl = href;
    } else {
      fullUrl = new URL(href, baseUrl).href;
    }

    // Remove query string and hash for deduplication
    const cleanUrl = fullUrl.split("#")[0].split("?")[0];

    // Skip asset files
    if (cleanUrl.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf|pdf|zip)$/i)) return;

    links.add(cleanUrl);
  });

  return links;
}

/**
 * Check if URL matches patterns
 */
function matchesPatterns(url: string, include: string[], exclude: string[]): boolean {
  const pathname = new URL(url).pathname;

  // Check exclude patterns first
  for (const pattern of exclude) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(pathname)) return false;
    } catch { /* skip invalid patterns */ }
  }

  // If no include patterns, include all
  if (include.length === 0) return true;

  // Check include patterns
  for (const pattern of include) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(pathname)) return true;
    } catch { /* skip invalid patterns */ }
  }

  return false;
}

/**
 * URL to file path
 */
function urlToFilePath(url: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const target = new URL(url);

  let pathname = target.pathname;
  if (pathname === "/" || pathname === "") return "index.html";

  // Remove leading slash
  pathname = pathname.replace(/^\//, "");

  // Add .html extension if not present
  if (!pathname.endsWith(".html") && !pathname.endsWith(".htm")) {
    pathname += ".html";
  }

  return pathname;
}

/**
 * Ensure directory exists
 */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Crawl a website and download pages
 */
export async function crawlSite(
  baseUrl: string,
  options: CrawlOptions
): Promise<CrawlResult> {
  const {
    outputDir,
    maxDepth = 2,
    maxPages = 50,
    includePatterns = [],
    excludePatterns = [
      "^/_next/",
      "^/static",
      "^/fonts/",
      "^/images/",
      "^/js/",
      "^/css/",
      "^/api/",
      "^/admin",
      "^/login",
      "^/signup",
      "^/account",
      "^/checkout",
      "^/cart",
    ],
    useBrowser = true,
    timeout = 30000,
    waitTime = 2000,
    onProgress,
    downloadAssets = true,
  } = options;

  const log = (msg: string) => onProgress?.(msg);

  log(`Starting crawl: ${baseUrl}`);
  log(`Max depth: ${maxDepth}, Max pages: ${maxPages}`);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Track visited and queued URLs
  const visited = new Set<string>();
  const queued: { url: string; depth: number }[] = [{ url: baseUrl, depth: 0 }];
  const pages: string[] = [];
  const failed: string[] = [];
  let totalAssets = 0;
  let totalSize = 0;

  // Launch browser if needed
  let browser: any = null;
  let page: any = null;

  if (useBrowser) {
    log("Launching browser...");
    const result = await connect({
      headless: true,
      customConfig: {},
      turnstile: true,
      connectOption: {},
      disableXvfb: false,
      ignoreAllFlags: false,
    });
    browser = result.browser;
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
  }

  try {
    while (queued.length > 0 && pages.length < maxPages) {
      const item = queued.shift()!;
      const { url, depth } = item;

      // Skip if already visited or depth exceeded
      if (visited.has(url)) continue;
      if (depth > maxDepth) continue;

      // Check patterns
      if (!matchesPatterns(url, includePatterns, excludePatterns)) {
        visited.add(url);
        continue;
      }

      visited.add(url);
      log(`[${pages.length + 1}/${maxPages}] Depth ${depth}: ${url}`);

      try {
        let html: string;

        if (useBrowser && page) {
          // Browser mode
          await page.goto(url, {
            waitUntil: "networkidle2",
            timeout,
          });
          await new Promise((r) => setTimeout(r, waitTime));
          html = await page.content();
        } else {
          // Simple HTTP fetch
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          html = await response.text();
        }

        // Save HTML
        const filePath = urlToFilePath(url, baseUrl);
        const outputPath = path.join(outputDir, filePath);
        ensureDir(outputPath);
        fs.writeFileSync(outputPath, html, "utf-8");
        totalSize += html.length;
        pages.push(url);
        log(`  ✓ Saved: ${filePath}`);

        // Download assets for this page if requested
        if (downloadAssets && pages.length <= 5) {
          // Only download assets for first few pages to avoid duplicates
          try {
            const result = await collectResources(url, {
              outputDir,
              downloadImages: true,
              downloadCss: true,
              downloadJs: true,
              concurrency: 3,
              timeout,
              useBrowser,
              onProgress: (msg) => log(`  ${msg}`),
            });
            totalAssets += result.stats.imagesDownloaded + result.stats.cssDownloaded + result.stats.jsDownloaded;
            totalSize += result.stats.totalSize;
          } catch { /* skip asset download errors */ }
        }

        // Extract and queue new links (only if depth not exceeded)
        if (depth < maxDepth) {
          const newLinks = extractInternalLinks(html, baseUrl);
          for (const link of newLinks) {
            if (!visited.has(link) && !queued.some(q => q.url === link)) {
              queued.push({ url: link, depth: depth + 1 });
            }
          }
          log(`  Found ${newLinks.size} links, queued ${queued.filter(q => !visited.has(q.url)).length} new`);
        }
      } catch (error) {
        failed.push(url);
        log(`  ✗ Failed: ${error instanceof Error ? error.message : "Unknown"}`);
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  log(`\nCrawl complete!`);
  log(`  Pages: ${pages.length} downloaded, ${failed.length} failed`);
  log(`  Assets: ${totalAssets}`);
  log(`  Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

  return {
    baseUrl,
    pages,
    failed,
    totalAssets,
    totalSize,
  };
}