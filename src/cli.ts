#!/usr/bin/env node

/**
 * Resource Collector CLI
 * Standalone tool for collecting website resources
 */

import { Command } from "commander";
import * as path from "path";
import { collectResources } from "./index.js";

const program = new Command();

program
  .name("resource-collector")
  .description("Collect CSS, JS, and images from a webpage. Automatically detects and bypasses Cloudflare when needed.")
  .version("1.0.0")
  .argument("<url>", "URL to collect resources from")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("--no-images", "Skip downloading images")
  .option("--no-css", "Skip downloading CSS")
  .option("--no-js", "Skip downloading JavaScript")
  .option("-c, --concurrency <number>", "Number of concurrent downloads", "5")
  .option("-t, --timeout <ms>", "Request timeout in milliseconds", "30000")
  .option("-H, --header <header>", "Custom header (can be used multiple times)", (value, prev: string[]) => [...prev, value], [] as string[])
  .option("--user-agent <ua>", "Custom user agent")
  .option("--browser", "Force browser mode (auto-detected by default)")
  .option("--wait-for <selector>", "Wait for selector before extracting (browser mode)")
  .action(async (url: string, options) => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Resource Collector v1.0.0             ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    // Parse headers
    const headers: Record<string, string> = {};
    for (const h of options.header) {
      const [key, ...valueParts] = h.split(":");
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join(":").trim();
      }
    }

    // Resolve output directory
    const outputDir = path.resolve(options.output);

    console.log(`URL: ${url}`);
    console.log(`Output: ${outputDir}`);
    console.log(`Mode: Auto-detect (switches to browser if blocked)`);
    console.log();

    try {
      const result = await collectResources(url, {
        outputDir,
        downloadImages: options.images,
        downloadCss: options.css,
        downloadJs: options.js,
        concurrency: parseInt(options.concurrency, 10),
        timeout: parseInt(options.timeout, 10),
        headers,
        userAgent: options.userAgent,
        useBrowser: options.browser,
        waitForSelector: options.waitFor,
        onProgress: (msg) => console.log(`  ${msg}`),
      });

      console.log();
      console.log("═══════════════════════════════════════════");
      console.log("Summary:");
      console.log(`  Images:   ${result.stats.imagesDownloaded} downloaded`);
      console.log(`  Fonts:    ${result.stats.fontsDownloaded} downloaded`);
      console.log(`  CSS:      ${result.stats.cssDownloaded} downloaded`);
      console.log(`  JS:       ${result.stats.jsDownloaded} downloaded`);
      console.log(`  Failed:   ${result.stats.failed}`);
      console.log(`  Size:     ${(result.stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log("═══════════════════════════════════════════");
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();