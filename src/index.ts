/**
 * Resource Collector - Main module for collecting website resources
 */

import * as fs from "fs";
import * as path from "path";
import { extractResources, extractCssResources } from "./extractor.js";
import { fetchUrl, fetchBinary } from "./fetcher.js";
import { normalizeUrl, getUrlFilename } from "./url-utils.js";
import { rewriteHtml, rewriteCss } from "./rewriter.js";
import { fetchWithBrowser, closeBrowser, fetchBinaryWithBrowser } from "./browser-fetcher.js";
import { fetchWithTlsBypass, isCloudflareChallenge } from "./cloudflare-bypass.js";

export interface CollectorOptions {
  /** Output directory */
  outputDir: string;
  /** Download images */
  downloadImages?: boolean;
  /** Download CSS */
  downloadCss?: boolean;
  /** Download JS */
  downloadJs?: boolean;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Concurrency limit for downloads */
  concurrency?: number;
  /** User agent */
  userAgent?: string;
  /** Progress callback */
  onProgress?: (message: string) => void;
  /** Use browser mode for JavaScript-heavy sites */
  useBrowser?: boolean;
  /** Wait for selector before extracting (browser mode) */
  waitForSelector?: string;
}

export interface CollectedResources {
  /** Source URL */
  url: string;
  /** Final URL (after redirects) */
  finalUrl: string;
  /** HTML content */
  html: string;
  /** Image URLs */
  images: string[];
  /** CSS URLs */
  css: string[];
  /** JS URLs */
  javascript: string[];
  /** Font URLs */
  fonts: string[];
  /** Download statistics */
  stats: {
    imagesDownloaded: number;
    cssDownloaded: number;
    jsDownloaded: number;
    fontsDownloaded: number;
    failed: number;
    totalSize: number;
  };
}

/**
 * Collect all resources from a webpage
 */
export async function collectResources(
  url: string,
  options: CollectorOptions
): Promise<CollectedResources> {
  const {
    outputDir,
    downloadImages = true,
    downloadCss = true,
    downloadJs = true,
    headers = {},
    timeout = 30000,
    concurrency = 5,
    userAgent,
    onProgress,
    useBrowser = false,
    waitForSelector,
  } = options;

  const log = (msg: string) => onProgress?.(msg);

  // Create output directories
  const dirs = {
    images: path.join(outputDir, "images"),
    css: path.join(outputDir, "css"),
    js: path.join(outputDir, "js"),
    fonts: path.join(outputDir, "fonts"),
  };

  for (const dir of Object.values(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Fetch the page
  log(`Fetching: ${url}`);

  let html: string;
  let finalUrl: string;
  let browserModeUsed = false;

  // Step 1: Try normal HTTP request first
  log("Trying normal HTTP request...");
  try {
    const pageResult = await fetchUrl(url, {
      headers,
      timeout,
      userAgent,
      referer: url,
    });

    html = pageResult.body;
    finalUrl = pageResult.url;

    // Check if we got blocked by Cloudflare or similar
    if (pageResult.status === 403 || pageResult.status === 503 || isCloudflareChallenge(html)) {
      log(`Blocked (HTTP ${pageResult.status}), trying TLS bypass...`);

      // Step 2: Try TLS bypass (faster than full browser)
      try {
        const tlsResult = await fetchWithTlsBypass(url, {
          timeout,
          headers,
          userAgent,
        });
        html = tlsResult.html;
        finalUrl = tlsResult.url;

        if (isCloudflareChallenge(html)) {
          log("TLS bypass blocked, switching to browser mode...");
          const browserResult = await fetchWithBrowser(url, {
            timeout: Math.max(timeout, 60000),
            waitForSelector,
            headers,
            userAgent,
          });
          html = browserResult.html;
          finalUrl = browserResult.url;
          browserModeUsed = true;
        }
      } catch (tlsError) {
        log("TLS bypass failed, switching to browser mode...");
        const browserResult = await fetchWithBrowser(url, {
          timeout: Math.max(timeout, 60000),
          waitForSelector,
          headers,
          userAgent,
        });
        html = browserResult.html;
        finalUrl = browserResult.url;
        browserModeUsed = true;
      }
    } else if (pageResult.status !== 200) {
      throw new Error(`Failed to fetch page: HTTP ${pageResult.status}`);
    }

    log(`Fetched: ${finalUrl}`);
  } catch (fetchError) {
    // Normal request failed, try browser mode
    log(`Normal request failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);

    if (useBrowser) {
      log("Trying browser mode (--browser flag)...");
      try {
        const browserResult = await fetchWithBrowser(url, {
          timeout: Math.max(timeout, 60000),
          waitForSelector,
          headers,
          userAgent,
        });
        html = browserResult.html;
        finalUrl = browserResult.url;
        browserModeUsed = true;
        log(`Fetched: ${finalUrl}`);
      } catch (browserError) {
        throw new Error(`Failed to fetch page: ${browserError instanceof Error ? browserError.message : String(browserError)}`);
      }
    } else {
      throw fetchError;
    }
  }

  // Extract resources from HTML
  const extracted = extractResources(html, finalUrl);
  log(`Found: ${extracted.images.length} images, ${extracted.css.length} CSS, ${extracted.javascript.length} JS`);

  // Stats
  const stats = {
    imagesDownloaded: 0,
    cssDownloaded: 0,
    jsDownloaded: 0,
    fontsDownloaded: 0,
    failed: 0,
    totalSize: 0,
  };

  // Track downloaded resources for rewriting
  const downloadedImages = new Set<string>();
  const downloadedCss = new Set<string>();
  const downloadedJs = new Set<string>();
  const downloadedFonts = new Set<string>();
  const downloadedCssPaths: string[] = [];
  const cssUrlToPath: Map<string, string> = new Map(); // Map CSS URL to local path

  // Global deduplication: track file hashes to prevent duplicate downloads
  const downloadedFileHashes = new Map<string, string>(); // hash -> filename
  const crypto = await import('crypto');

  /**
   * Check if file content is already downloaded (by hash)
   * Returns existing filename if duplicate, null if new
   */
  const checkDuplicateByHash = (buffer: Buffer): string | null => {
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    return downloadedFileHashes.get(hash) || null;
  };

  /**
   * Register a newly downloaded file by its hash
   */
  const registerFileHash = (buffer: Buffer, filename: string): void => {
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    downloadedFileHashes.set(hash, filename);
  };

  // Helper to check if URL needs browser mode (different origin or Cloudflare)
  const needsBrowserMode = (resourceUrl: string): boolean => {
    if (!browserModeUsed) return false;
    try {
      const resourceOrigin = new URL(resourceUrl).origin;
      const pageOrigin = new URL(finalUrl).origin;
      // Same origin resources don't need browser mode
      return resourceOrigin !== pageOrigin;
    } catch {
      return browserModeUsed;
    }
  };

  // Helper to download files with concurrency (supports browser mode)
  const downloadWithConcurrency = async (
    urls: string[],
    outputDir: string,
    label: string,
    downloadedSet?: Set<string>,
    downloadedPaths?: string[]
  ): Promise<number> => {
    let downloaded = 0;
    const queue = [...urls];
    const active = new Set<Promise<void>>();

    const processNext = async () => {
      while (queue.length > 0) {
        const currentUrl = queue.shift();
        if (!currentUrl) break;

        try {
          const filename = getSafeFilename(currentUrl, outputDir);
          const outputPath = path.join(outputDir, filename);

          // Skip if file already exists on disk
          if (fs.existsSync(outputPath)) {
            // Still track the URL for rewriting
            if (downloadedSet) {
              downloadedSet.add(currentUrl);
            }
            continue;
          }

          // Use browser fetch only for cross-origin resources when browser mode is enabled
          const useBrowserForThisRequest = needsBrowserMode(currentUrl);
          const result = useBrowserForThisRequest
            ? await fetchBinaryWithBrowser(currentUrl, { timeout, headers, userAgent })
            : await fetchBinary(currentUrl, {
                headers,
                timeout,
                userAgent,
                referer: url,
              });

          if (result.status === 200 && result.buffer.length > 0) {
            // Check for duplicates by content hash
            const existingFile = checkDuplicateByHash(result.buffer);
            if (existingFile) {
              log(`Skipped duplicate [${label}]: ${filename} (same as ${existingFile})`);
              if (downloadedSet) {
                downloadedSet.add(currentUrl);
              }
              continue;
            }

            fs.writeFileSync(outputPath, result.buffer);
            registerFileHash(result.buffer, filename);
            stats.totalSize += result.buffer.length;
            downloaded++;
            if (downloadedSet) {
              downloadedSet.add(currentUrl);
            }
            if (downloadedPaths) {
              downloadedPaths.push(outputPath);
            }
            log(`Downloaded [${label}]: ${filename}`);
          } else {
            stats.failed++;
            log(`Failed [${label}]: ${filename} (status: ${result.status}, size: ${result.buffer.length})`);
          }
        } catch (error) {
          stats.failed++;
          log(`Error [${label}]: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };

    // Start concurrent downloads
    const workers = [];
    for (let i = 0; i < Math.min(concurrency, urls.length); i++) {
      workers.push(processNext());
    }
    await Promise.all(workers);

    return downloaded;
  };

  // Download resources
  if (downloadCss && extracted.css.length > 0) {
    log("Downloading CSS files...");

    // Download CSS files and track URL to path mapping
    for (const cssUrl of extracted.css) {
      try {
        const filename = getSafeFilename(cssUrl, dirs.css);
        const outputPath = path.join(dirs.css, filename);

        if (!fs.existsSync(outputPath)) {
          // Use browser fetch if browser mode was used
          const result = browserModeUsed
            ? await fetchBinaryWithBrowser(cssUrl, { timeout, headers, userAgent })
            : await fetchBinary(cssUrl, {
                headers,
                timeout,
                userAgent,
                referer: url,
              });

          if (result.status === 200 && result.buffer.length > 0) {
            fs.writeFileSync(outputPath, result.buffer);
            stats.totalSize += result.buffer.length;
            stats.cssDownloaded++;
            log(`Downloaded [CSS]: ${filename}`);
          } else {
            stats.failed++;
            continue;
          }
        }

        downloadedCss.add(cssUrl);
        downloadedCssPaths.push(outputPath);
        cssUrlToPath.set(cssUrl, outputPath);
      } catch (error) {
        stats.failed++;
      }
    }

    // Also extract images and fonts from downloaded CSS
    for (const [cssUrl, cssPath] of cssUrlToPath) {
      try {
        if (fs.existsSync(cssPath)) {
          const cssContent = fs.readFileSync(cssPath, "utf-8");
          // Use original CSS URL as base for resolving relative paths
          const cssResources = extractCssResources(cssContent, cssUrl);

          if (downloadImages && cssResources.images.length > 0) {
            log(`Found ${cssResources.images.length} images in CSS: ${path.basename(cssPath)}`);
            const additionalImages = await downloadWithConcurrency(
              cssResources.images,
              dirs.images,
              "CSS-Image",
              downloadedImages
            );
            stats.imagesDownloaded += additionalImages;
          }

          // Download fonts from CSS
          if (cssResources.fonts.length > 0) {
            log(`Found ${cssResources.fonts.length} fonts in CSS: ${path.basename(cssPath)}`);
            const fontDownloads = await downloadWithConcurrency(
              cssResources.fonts,
              dirs.fonts,
              "Font",
              downloadedFonts
            );
            stats.fontsDownloaded += fontDownloads;
          }
        }
      } catch (error) {
        // Ignore CSS parsing errors
      }
    }
  }

  if (downloadJs && extracted.javascript.length > 0) {
    log("Downloading JS files...");
    stats.jsDownloaded = await downloadWithConcurrency(
      extracted.javascript,
      dirs.js,
      "JS",
      downloadedJs
    );
  }

  if (downloadImages && extracted.images.length > 0) {
    log("Downloading images...");
    const imageDownloads = await downloadWithConcurrency(
      extracted.images,
      dirs.images,
      "Image",
      downloadedImages
    );
    stats.imagesDownloaded += imageDownloads;
  }

  // Download meta images (og:image, twitter:image)
  if (downloadImages && extracted.metaImages.length > 0) {
    log("Downloading meta images (og:image, twitter:image)...");
    const metaImageDownloads = await downloadWithConcurrency(
      extracted.metaImages,
      dirs.images,
      "Meta-Image",
      downloadedImages
    );
    stats.imagesDownloaded += metaImageDownloads;
  }

  // Download fonts from preload
  if (extracted.fonts.length > 0) {
    log("Downloading preload fonts...");
    const fontDownloads = await downloadWithConcurrency(
      extracted.fonts,
      dirs.fonts,
      "Preload-Font",
      downloadedFonts
    );
    stats.fontsDownloaded += fontDownloads;
  }

  // Rewrite CSS files with local paths
  log("Rewriting CSS paths...");
  for (const [cssUrl, cssPath] of cssUrlToPath) {
    try {
      if (fs.existsSync(cssPath)) {
        const cssContent = fs.readFileSync(cssPath, "utf-8");
        const rewrittenCss = rewriteCss(cssContent, cssUrl, downloadedImages, downloadedFonts);
        fs.writeFileSync(cssPath, rewrittenCss);
      }
    } catch (error) {
      // Ignore CSS rewriting errors
    }
  }

  // Also rewrite CSS files that were already present
  for (const cssUrl of extracted.css) {
    const filename = getSafeFilename(cssUrl, dirs.css);
    const cssPath = path.join(dirs.css, filename);
    if (fs.existsSync(cssPath) && !cssUrlToPath.has(cssUrl)) {
      try {
        const cssContent = fs.readFileSync(cssPath, "utf-8");
        const rewrittenCss = rewriteCss(cssContent, cssUrl, downloadedImages, downloadedFonts);
        fs.writeFileSync(cssPath, rewrittenCss);
      } catch (error) {
        // Ignore CSS rewriting errors
      }
    }
  }

  // Rewrite HTML with local paths
  log("Rewriting HTML paths...");
  const rewrittenHtml = rewriteHtml(
    html,
    finalUrl,
    downloadedImages,
    downloadedCss,
    downloadedJs,
    downloadedFonts
  );

  // Save HTML
  const htmlPath = path.join(outputDir, "index.html");
  fs.writeFileSync(htmlPath, rewrittenHtml);
  stats.totalSize += rewrittenHtml.length;

  log(`Done! Total size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);

  return {
    url,
    finalUrl,
    html,
    images: extracted.images,
    css: extracted.css,
    javascript: extracted.javascript,
    fonts: extracted.fonts,
    stats,
  };
}

/**
 * Get a safe filename from URL
 */
function getSafeFilename(url: string, outputDir: string): string {
  try {
    const urlObj = new URL(url);
    let filename = urlObj.pathname.split("/").pop() || "";

    // Decode URL-encoded characters
    try {
      filename = decodeURIComponent(filename);
    } catch {
      // Keep encoded if decode fails
    }

    // Remove query string
    filename = filename.split("?")[0];

    // Sanitize
    filename = filename.replace(/[<>:"/\\|?*]/g, "_");

    // Handle empty or generic filenames
    if (!filename || filename === "." || filename === "image" || filename.length < 2) {
      // Generate filename from URL hash
      const urlHash = Buffer.from(url).toString('base64').slice(0, 12).replace(/[+/=]/g, '_');
      filename = `resource_${urlHash}`;
    }

    // Ensure not empty
    if (!filename || filename === ".") {
      filename = "file_" + Date.now();
    }

    // Handle duplicates
    const fullPath = path.join(outputDir, filename);
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let counter = 1;
      while (fs.existsSync(path.join(outputDir, `${base}_${counter}${ext}`))) {
        counter++;
      }
      filename = `${base}_${counter}${ext}`;
    }

    return filename;
  } catch {
    return `file_${Date.now()}`;
  }
}

export { extractResources, extractCssResources } from "./extractor.js";
export { fetchUrl, fetchBinary } from "./fetcher.js";
export * from "./url-utils.js";