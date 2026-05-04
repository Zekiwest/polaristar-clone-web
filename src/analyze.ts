/**
 * Analyze Module - Website structure analysis
 * Extracts navigation, routes, and site structure information
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 网站结构分析，提取导航、路由、collection/product 列表
 * 依赖关系: puppeteer-real-browser, cheerio
 * 变更同步: 修改分析逻辑时更新 PROJECT_INDEX.md 命令表和 src/_dir.md
 * ──────────────────────────────────────────────────────────────────────────
 */

import { connect } from "puppeteer-real-browser";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

export interface AnalyzeOptions {
  /** Use browser mode for dynamic content */
  useBrowser?: boolean;
  /** Request timeout */
  timeout?: number;
  /** Wait time after page load */
  waitTime?: number;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export interface AnalyzeResult {
  /** Base URL */
  baseUrl: string;
  /** Navigation links */
  navigation: NavLink[];
  /** All internal routes */
  routes: string[];
  /** Collection routes (e.g., /collections/*) */
  collections: string[];
  /** Product routes (e.g., /products/*) */
  products: string[];
  /** Page structure info */
  structure: {
    title: string;
    metaDescription: string;
    h1Count: number;
    imageCount: number;
    linkCount: number;
  };
}

export interface NavLink {
  text: string;
  href: string;
  type: "navigation" | "collection" | "product" | "other";
}

/**
 * Extract internal links from HTML
 */
function extractLinks(html: string, baseUrl: string): NavLink[] {
  const links: NavLink[] = [];
  const $ = cheerio.load(html);
  const baseOrigin = new URL(baseUrl).origin;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();

    // Skip empty or external links
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (href.startsWith("http") && !href.startsWith(baseOrigin)) return;

    // Normalize URL
    let fullUrl: string;
    if (href.startsWith("/")) {
      fullUrl = baseOrigin + href;
    } else if (href.startsWith("http")) {
      fullUrl = href;
    } else {
      fullUrl = new URL(href, baseUrl).href;
    }

    // Determine type
    const pathname = new URL(fullUrl).pathname;
    let type: NavLink["type"] = "other";
    if (pathname.startsWith("/collections/")) type = "collection";
    else if (pathname.startsWith("/products/")) type = "product";
    else if (pathname === "/" || pathname.match(/^\/[a-z-]+$/)) type = "navigation";

    // Skip asset files
    if (pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|pdf)$/i)) return;

    links.push({ text, href: pathname, type });
  });

  return links;
}

/**
 * Analyze a website structure
 */
export async function analyzeSite(
  url: string,
  options: AnalyzeOptions = {}
): Promise<AnalyzeResult> {
  const {
    useBrowser = true,
    timeout = 30000,
    waitTime = 3000,
    onProgress,
  } = options;

  const log = (msg: string) => onProgress?.(msg);
  log(`Analyzing: ${url}`);

  let html: string;

  if (useBrowser) {
    log("Launching browser...");
    const { browser } = await connect({
      headless: true,
      customConfig: {},
      turnstile: true,
      connectOption: {},
      disableXvfb: false,
      ignoreAllFlags: false,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    log("Loading page...");
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout,
    });
    await new Promise((r) => setTimeout(r, waitTime));

    // Try to hover over navigation menus to reveal hidden links
    const menuSelectors = [
      "nav a",
      ".header__menu-item",
      ".nav__link",
      "[data-menu-handle]",
      "button[aria-controls]",
      ".menu-toggle",
      ".dropdown-toggle",
    ];

    for (const selector of menuSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          log(`Hovering on ${elements.length} menu items (${selector})`);
          for (const el of elements.slice(0, 5)) {
            await el.hover();
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } catch { /* skip */ }
    }

    html = await page.content();
    await browser.close();
  } else {
    log("Fetching page...");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  }

  // Parse HTML
  const $ = cheerio.load(html);
  const links = extractLinks(html, url);

  // Deduplicate routes
  const allRoutes = new Set<string>();
  const collections: string[] = [];
  const products: string[] = [];

  for (const link of links) {
    allRoutes.add(link.href);
    if (link.type === "collection" && !collections.includes(link.href)) {
      collections.push(link.href);
    }
    if (link.type === "product" && !products.includes(link.href)) {
      products.push(link.href);
    }
  }

  // Get page structure
  const title = $("title").text() || "";
  const metaDescription = $("meta[name='description']").attr("content") || "";
  const h1Count = $("h1").length;
  const imageCount = $("img").length;
  const linkCount = $("a[href]").length;

  log(`Found ${allRoutes.size} routes, ${collections.length} collections, ${products.length} products`);

  return {
    baseUrl: url,
    navigation: links.filter(l => l.type === "navigation"),
    routes: [...allRoutes].sort(),
    collections,
    products,
    structure: {
      title,
      metaDescription,
      h1Count,
      imageCount,
      linkCount,
    },
  };
}

/**
 * Analyze downloaded HTML files for routes
 */
export function analyzeLocalFiles(outputDir: string): string[] {
  const routes = new Set<string>();

  function processDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        processDirectory(fullPath);
      } else if (entry.name.endsWith(".html")) {
        const html = fs.readFileSync(fullPath, "utf-8");
        const hrefRegex = /href="([^"]*)"/g;
        let match;
        while ((match = hrefRegex.exec(html)) !== null) {
          const href = match[1];
          if (
            href.startsWith("http") ||
            href.startsWith("//") ||
            href.startsWith("mailto:") ||
            href.startsWith("tel:") ||
            href.startsWith("#") ||
            href === ""
          ) continue;

          let clean = href.split("#")[0].split("?")[0];
          if (!clean.startsWith("/")) continue;
          if (clean.match(/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|pdf)$/i)) continue;

          routes.add(clean);
        }
      }
    }
  }

  processDirectory(outputDir);
  return [...routes].sort();
}