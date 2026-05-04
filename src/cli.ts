#!/usr/bin/env node

/**
 * Polaristar CLI
 * Professional website resource collector with subscription support
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: CLI 入口点，解析命令并调用对应模块
 * 依赖关系: index.ts, crawl.ts, analyze.ts, fix.ts, server.ts, template.ts, auth.ts
 * 变更同步: 新增命令时更新 PROJECT_INDEX.md 命令表和 src/_dir.md 模块清单
 * ──────────────────────────────────────────────────────────────────────────
 */

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { collectResources } from "./index.js";
import { crawlSite } from "./crawl.js";
import { analyzeSite, analyzeLocalFiles } from "./analyze.js";
import { fixDirectory } from "./fix.js";
import { startServer, stopServer } from "./server.js";
import { extractTemplateConfig, applyTemplateConfig } from "./template.js";
import {
  loadConfig,
  checkSubscription,
  reportUsage,
  login,
  logout,
  formatStatus,
  getCurrentMonthUsage,
  isCommandAllowed,
  getMachineId,
  TIER_LIMITS,
} from "./auth.js";

const program = new Command();

// Subscription check wrapper
async function checkAuth(command: string): Promise<{ allowed: boolean; tier: string; message?: string }> {
  const config = loadConfig();

  if (!config) {
    return {
      allowed: false,
      tier: "free",
      message: "Not logged in. Run 'polaristar login <api-key>' first.",
    };
  }

  const status = await checkSubscription(config);

  if (!status.active) {
    return {
      allowed: false,
      tier: status.tier,
      message: status.error || "Subscription inactive.",
    };
  }

  // Check command access
  if (!isCommandAllowed(command, status.tier)) {
    return {
      allowed: false,
      tier: status.tier,
      message: `Command '${command}' requires ${getRequiredTier(command)} tier. Current: ${status.tier}`,
    };
  }

  // Check page limit
  if (status.pageLimit !== -1 && status.pagesUsed >= status.pageLimit) {
    return {
      allowed: false,
      tier: status.tier,
      message: `Monthly page limit (${status.pageLimit}) exceeded. Pages used: ${status.pagesUsed}`,
    };
  }

  return { allowed: true, tier: status.tier };
}

function getRequiredTier(command: string): string {
  const tiers = ["free", "basic", "pro", "enterprise"];
  for (const tier of tiers) {
    if (isCommandAllowed(command, tier)) {
      return tier;
    }
  }
  return "enterprise";
}

program
  .name("polaristar")
  .description("Polaristar CLI - Professional website resource collector")
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
  .option("-s, --serve [port]", "Start local HTTP server after collecting (default port: 3000)")
  .action(async (url: string, options) => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
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

      // Start local server if requested
      if (options.serve !== false && options.serve !== undefined) {
        const port = typeof options.serve === "string" ? parseInt(options.serve, 10) : 3000;
        const { url: serverUrl } = await startServer({
          port,
          outputDir,
          baseUrl: url,
        });
        console.log(`\n  Open ${serverUrl} in your browser`);

        // Keep process alive
        process.on("SIGINT", () => {
          stopServer();
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ─── Crawl Command ─────────────────────────────────────────

program
  .command("crawl")
  .description("Crawl and download entire website (multi-page)")
  .argument("<url>", "Starting URL to crawl")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("-d, --depth <number>", "Maximum crawl depth", "2")
  .option("-m, --max-pages <number>", "Maximum pages to download", "50")
  .option("--include <pattern>", "Include pattern (regex, can be used multiple times)", (value, prev: string[]) => [...prev, value], [] as string[])
  .option("--exclude <pattern>", "Exclude pattern (regex, can be used multiple times)", (value, prev: string[]) => [...prev, value], [] as string[])
  .option("--no-browser", "Disable browser mode (use simple HTTP)")
  .option("--no-assets", "Skip downloading assets for each page")
  .option("-t, --timeout <ms>", "Request timeout in milliseconds", "30000")
  .option("--wait <ms>", "Wait time after page load", "2000")
  .action(async (url: string, options) => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    const outputDir = path.resolve(options.output);

    console.log(`URL: ${url}`);
    console.log(`Output: ${outputDir}`);
    console.log(`Depth: ${options.depth}`);
    console.log(`Max pages: ${options.maxPages}`);
    console.log();

    try {
      const result = await crawlSite(url, {
        outputDir,
        maxDepth: parseInt(options.depth, 10),
        maxPages: parseInt(options.maxPages, 10),
        includePatterns: options.include,
        excludePatterns: options.exclude,
        useBrowser: options.browser !== false,
        timeout: parseInt(options.timeout, 10),
        waitTime: parseInt(options.wait, 10),
        downloadAssets: options.assets !== false,
        onProgress: (msg) => console.log(`  ${msg}`),
      });

      console.log();
      console.log("═══════════════════════════════════════════");
      console.log("Summary:");
      console.log(`  Pages:    ${result.pages.length} downloaded`);
      console.log(`  Failed:   ${result.failed.length}`);
      console.log(`  Assets:   ${result.totalAssets}`);
      console.log(`  Size:     ${(result.totalSize / 1024 / 1024).toFixed(2)} MB`);
      console.log("═══════════════════════════════════════════");
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ─── Analyze Command ─────────────────────────────────────────

program
  .command("analyze")
  .description("Analyze website structure and extract navigation/routes")
  .argument("<url-or-dir>", "URL to analyze OR local directory with HTML files")
  .option("--no-browser", "Disable browser mode (use simple HTTP)")
  .option("-t, --timeout <ms>", "Request timeout in milliseconds", "30000")
  .option("--wait <ms>", "Wait time after page load", "3000")
  .option("-o, --output <file>", "Save analysis result to JSON file")
  .option("--nav", "Show navigation links only")
  .option("--routes", "Show routes only")
  .option("--collections", "Show collection routes only")
  .option("--products", "Show product routes only")
  .action(async (input: string, options) => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    const isUrl = input.startsWith("http://") || input.startsWith("https://");

    try {
      if (isUrl) {
        // Analyze live URL
        console.log(`Analyzing URL: ${input}`);
        console.log();

        const result = await analyzeSite(input, {
          useBrowser: options.browser !== false,
          timeout: parseInt(options.timeout, 10),
          waitTime: parseInt(options.wait, 10),
          onProgress: (msg) => console.log(`  ${msg}`),
        });

        console.log();
        console.log("═══════════════════════════════════════════");
        console.log("Site Analysis:");
        console.log("═══════════════════════════════════════════");
        console.log(`  Title: ${result.structure.title}`);
        console.log(`  Description: ${result.structure.metaDescription.slice(0, 60)}...`);
        console.log(`  H1 tags: ${result.structure.h1Count}`);
        console.log(`  Images: ${result.structure.imageCount}`);
        console.log(`  Links: ${result.structure.linkCount}`);
        console.log();

        if (!options.collections && !options.products && !options.routes) {
          // Show all
          console.log(`Navigation (${result.navigation.length}):`);
          result.navigation.forEach(l => console.log(`  ${l.href} - ${l.text}`));
          console.log();

          console.log(`Collections (${result.collections.length}):`);
          result.collections.forEach(r => console.log(`  ${r}`));
          console.log();

          console.log(`Products (${result.products.length}):`);
          result.products.forEach(r => console.log(`  ${r}`));
          console.log();

          console.log(`All Routes (${result.routes.length}):`);
          result.routes.slice(0, 50).forEach(r => console.log(`  ${r}`));
          if (result.routes.length > 50) console.log(`  ... and ${result.routes.length - 50} more`);
        } else {
          // Show specific sections
          if (options.nav) {
            console.log(`Navigation (${result.navigation.length}):`);
            result.navigation.forEach(l => console.log(`  ${l.href} - ${l.text}`));
          }
          if (options.routes) {
            console.log(`Routes (${result.routes.length}):`);
            result.routes.forEach(r => console.log(`  ${r}`));
          }
          if (options.collections) {
            console.log(`Collections (${result.collections.length}):`);
            result.collections.forEach(r => console.log(`  ${r}`));
          }
          if (options.products) {
            console.log(`Products (${result.products.length}):`);
            result.products.forEach(r => console.log(`  ${r}`));
          }
        }

        // Save to file if requested
        if (options.output) {
          const outputPath = path.resolve(options.output);
          fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
          console.log(`\nSaved to: ${outputPath}`);
        }
      } else {
        // Analyze local directory
        const dir = path.resolve(input);
        if (!fs.existsSync(dir)) {
          console.error(`Error: directory not found at ${dir}`);
          process.exit(1);
        }

        console.log(`Analyzing local files: ${dir}`);
        console.log();

        const routes = analyzeLocalFiles(dir);

        console.log("═══════════════════════════════════════════");
        console.log(`Found ${routes.length} unique routes:`);
        console.log("═══════════════════════════════════════════");
        routes.forEach(r => console.log(`  ${r}`));

        if (options.output) {
          const outputPath = path.resolve(options.output);
          fs.writeFileSync(outputPath, JSON.stringify({ routes }, null, 2));
          console.log(`\nSaved to: ${outputPath}`);
        }
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ─── Fix Command ─────────────────────────────────────────

program
  .command("fix")
  .description("Fix broken links, CDN URLs, and font references in downloaded files")
  .argument("<output-dir>", "Path to the downloaded site directory")
  .option("--links", "Fix internal links (absolute to relative)", true)
  .option("--cdn", "Fix CDN URLs to local paths", true)
  .option("--fonts", "Fix font URLs to local paths", true)
  .option("--base-url <url>", "Original site URL (for link fixing)")
  .option("--external <domain>", "External domain to keep as-is (can be used multiple times)", (value, prev: string[]) => [...prev, value], [] as string[])
  .action(async (outputDir: string, options) => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    const dir = path.resolve(outputDir);
    if (!fs.existsSync(dir)) {
      console.error(`Error: directory not found at ${dir}`);
      process.exit(1);
    }

    console.log(`Fixing files in: ${dir}`);
    console.log(`  Links: ${options.links !== false ? "yes" : "no"}`);
    console.log(`  CDN: ${options.cdn !== false ? "yes" : "no"}`);
    console.log(`  Fonts: ${options.fonts !== false ? "yes" : "no"}`);
    if (options.baseUrl) console.log(`  Base URL: ${options.baseUrl}`);
    console.log();

    try {
      const result = fixDirectory(dir, {
        fixLinks: options.links !== false,
        fixCdn: options.cdn !== false,
        fixFonts: options.fonts !== false,
        baseUrl: options.baseUrl,
        externalDomains: options.external,
        onProgress: (msg) => console.log(`  ${msg}`),
      });

      console.log();
      console.log("═══════════════════════════════════════════");
      console.log("Summary:");
      console.log(`  Files:      ${result.filesProcessed} processed`);
      console.log(`  Changed:    ${result.filesChanged}`);
      console.log(`  Links:      ${result.linkReplacements} fixed`);
      console.log(`  CDN:        ${result.cdnReplacements} fixed`);
      console.log(`  Fonts:      ${result.fontReplacements} fixed`);
      console.log(`  Total:      ${result.totalReplacements} replacements`);
      console.log("═══════════════════════════════════════════");
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ─── Auth Commands ─────────────────────────────────────────

// Login with API key
program
  .command("login")
  .description("Login with your Polaristar API key")
  .argument("<api-key>", "Your API key from polaristar.com")
  .action(async (apiKey: string) => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    console.log("Logging in...");
    const result = await login(apiKey);

    if (result.success) {
      console.log("\n✓ Login successful!");
      console.log(result.message);
      console.log(`\nMachine ID: ${getMachineId()}`);
    } else {
      console.log("\n✗ Login failed");
      console.log(result.message);
    }
  });

// Check subscription status
program
  .command("status")
  .description("Check subscription status and usage")
  .action(async () => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    const config = loadConfig();

    if (!config) {
      console.log("Not logged in. Run 'polaristar login <api-key>' first.");
      console.log("\nGet your API key at: https://polaristar.com");
      return;
    }

    console.log("Checking subscription status...\n");

    const status = await checkSubscription(config);
    console.log(formatStatus(status));
    console.log(`\nMachine ID: ${getMachineId()}`);

    // Show current month usage
    const localUsage = getCurrentMonthUsage();
    console.log(`Local usage this month: ${localUsage} pages`);
  });

// Logout
program
  .command("logout")
  .description("Logout and clear local configuration")
  .action(() => {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    logout();
    console.log("✓ Logged out successfully.");
    console.log("Run 'polaristar login <api-key>' to login again.");
  });

// ─── Serve Command ─────────────────────────────────────────

program
  .command("serve")
  .description("Serve a collected/exported site locally")
  .argument("<output-dir>", "Path to the site directory")
  .option("-p, --port <number>", "Port to serve on", "3000")
  .action(async (outputDir: string, options) => {
    const dir = path.resolve(outputDir);
    if (!fs.existsSync(dir)) {
      console.error(`Error: directory not found at ${dir}`);
      process.exit(1);
    }

    console.log("╔═══════════════════════════════════════════╗");
    console.log("║     Polaristar CLI v1.0.0                 ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();

    const port = parseInt(options.port, 10);
    const { url: serverUrl } = await startServer({
      port,
      outputDir: dir,
    });
    console.log(`\n  Open ${serverUrl} in your browser`);
    console.log(`  Press Ctrl+C to stop`);

    process.on("SIGINT", () => {
      stopServer();
      process.exit(0);
    });
  });

// ─── Template Commands ─────────────────────────────────────────

const templateCmd = program.command("template");
templateCmd.description("Template extraction and customization tools");

// Extract template config from collected output
templateCmd
  .command("extract")
  .description("Extract customizable config from a collected site")
  .argument("<output-dir>", "Path to the collected output directory")
  .option("-o, --config <path>", "Output config file path", "./template-config.json")
  .action(async (outputDir: string, options) => {
    const htmlPath = path.resolve(outputDir, "index.html");
    if (!fs.existsSync(htmlPath)) {
      console.error(`Error: index.html not found at ${htmlPath}`);
      process.exit(1);
    }

    const html = fs.readFileSync(htmlPath, "utf-8");
    const config = extractTemplateConfig(html, outputDir);

    const configPath = path.resolve(options.config);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Template config extracted to: ${configPath}`
    );
    console.log(`  Title: ${config.meta.title}`);
    console.log(`  Colors: bg=${config.colors.background}, text=${config.colors.text}, accent=${config.colors.accent}`);
    console.log(`  Images: ${config.images.length} found`);
    console.log(`  Fonts: ${config.fonts.length} found`);
    console.log(`  Social links: ${Object.keys(config.socialLinks).length} found`);
    console.log(`  Navigation: ${config.navigation.length} items`);
  });

// Apply template config to customize a collected site
templateCmd
  .command("apply")
  .description("Apply customizations to a collected site")
  .argument("<output-dir>", "Path to the collected output directory")
  .argument("<config-file>", "Path to template config JSON")
  .option("--title <title>", "Override site title")
  .option("--bg <color>", "Override background color")
  .option("--text <color>", "Override text color")
  .option("--accent <color>", "Override accent color")
  .action(async (outputDir: string, configFile: string, options) => {
    const htmlPath = path.resolve(outputDir, "index.html");
    if (!fs.existsSync(htmlPath)) {
      console.error(`Error: index.html not found at ${htmlPath}`);
      process.exit(1);
    }

    let config: Record<string, unknown> = {};
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    }

    // Apply CLI overrides
    const overrides: Record<string, unknown> = {};
    if (options.title) overrides.meta = { ...(config.meta as Record<string, unknown> || {}), title: options.title };
    if (options.bg || options.text || options.accent) {
      overrides.colors = {
        ...(config.colors as Record<string, unknown> || {}),
        ...(options.bg ? { background: options.bg } : {}),
        ...(options.text ? { text: options.text } : {}),
        ...(options.accent ? { accent: options.accent } : {}),
      };
    }

    const merged = { ...config, ...overrides };
    const html = fs.readFileSync(htmlPath, "utf-8");
    const newHtml = applyTemplateConfig(html, merged);

    // Backup original
    const backupPath = htmlPath + ".bak";
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(htmlPath, backupPath);
    }

    fs.writeFileSync(htmlPath, newHtml);
    console.log("Template applied successfully!");
    if (options.title) console.log(`  Title: ${options.title}`);
    if (options.bg) console.log(`  Background: ${options.bg}`);
    if (options.text) console.log(`  Text: ${options.text}`);
    if (options.accent) console.log(`  Accent: ${options.accent}`);
  });

// Export template as standalone project
templateCmd
  .command("export")
  .description("Export collected site as a clean standalone project")
  .argument("<output-dir>", "Path to the collected output directory")
  .option("--dest <path>", "Destination directory", "./template-export")
  .option("--clean", "Remove Next.js build artifacts", true)
  .action(async (outputDir: string, options) => {
    const src = path.resolve(outputDir);
    const dest = path.resolve(options.dest);

    if (!fs.existsSync(src)) {
      console.error(`Error: source directory not found at ${src}`);
      process.exit(1);
    }

    console.log(`Exporting template...`);
    console.log(`  Source: ${src}`);
    console.log(`  Destination: ${dest}`);

    // Copy directory
    fs.cpSync(src, dest, { recursive: true, dereference: true });

    // Clean up Next.js artifacts if requested
    if (options.clean) {
      const jsDir = path.join(dest, "js");
      if (fs.existsSync(jsDir)) {
        const files = fs.readdirSync(jsDir);
        const keptFiles = new Set<string>();

        // Read HTML to find which JS files are actually referenced
        const htmlPath = path.join(dest, "index.html");
        if (fs.existsSync(htmlPath)) {
          const html = fs.readFileSync(htmlPath, "utf-8");
          const matches = html.match(/src="js\/([^"]+)"/g) || [];
          matches.forEach((m) => {
            const file = m.match(/src="js\/([^"]+)"/)?.[1];
            if (file) keptFiles.add(file);
          });

          // Remove unreferenced JS files
          let removed = 0;
          for (const file of files) {
            if (!keptFiles.has(file)) {
              fs.unlinkSync(path.join(jsDir, file));
              removed++;
            }
          }
          console.log(`  Removed ${removed} unreferenced JS files`);
        }
      }

      // Remove _next/ directory if it exists
      const nextDir = path.join(dest, "_next");
      if (fs.existsSync(nextDir)) {
        fs.rmSync(nextDir, { recursive: true, force: true });
        console.log(`  Removed _next/ directory`);
      }
    }

    // Generate template config
    const htmlPath = path.join(dest, "index.html");
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, "utf-8");
      const config = extractTemplateConfig(html, dest);
      fs.writeFileSync(
        path.join(dest, "template-config.json"),
        JSON.stringify(config, null, 2)
      );
      console.log(`  Generated template-config.json`);
    }

    // Show stats
    const totalSize = getDirSize(dest);
    console.log(`\nExport complete!`);
    console.log(`  Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Files: ${countFiles(dest)}`);
  });

function getDirSize(dir: string): number {
  let size = 0;
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(full);
      } else {
        size += fs.statSync(full).size;
      }
    }
  }
  return size;
}

function countFiles(dir: string): number {
  let count = 0;
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFiles(full);
      } else {
        count++;
      }
    }
  }
  return count;
}

program.parse();