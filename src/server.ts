/**
 * Local HTTP Server - Serves cloned site with proper CORS and proxy
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 本地 HTTP 服务器，支持离线预览和 Next.js 路由模拟
 * 依赖关系: http, fs, path, url (Node.js 内置)
 * 变更同步: 修改路由处理时更新 PROJECT_INDEX.md 命令表和 src/_dir.md
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

export interface ServerOptions {
  port?: number;
  outputDir: string;
  baseUrl?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".xml": "application/xml",
};

let server: http.Server | null = null;

/**
 * Determine MIME type from file path
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Check if MIME type is a font
 */
function isFont(pathname: string): boolean {
  return /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(pathname);
}

/**
 * Create and start local HTTP server
 */
export async function startServer(options: ServerOptions): Promise<{ port: number; url: string }> {
  const { outputDir } = options;
  const port = options.port || 3000;

  server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || "/", true);
    let pathname = parsedUrl.pathname || "/";

    // Default to index.html for root
    if (pathname === "/") {
      pathname = "/index.html";
    }

    // Handle Next.js image optimization proxy
    if (pathname.startsWith("/_next/image")) {
      const imgUrl = parsedUrl.query.url;
      if (typeof imgUrl === "string") {
        try {
          const decoded = decodeURIComponent(imgUrl);

          // If decoded is a local path (starts with /), serve from filesystem
          if (decoded.startsWith("/")) {
            const filePath = path.join(outputDir, decoded);
            const resolved = path.resolve(filePath);
            const outputResolved = path.resolve(outputDir);
            if (resolved.startsWith(outputResolved) && fs.existsSync(filePath)) {
              const content = fs.readFileSync(filePath);
              const mime = getMimeType(filePath);
              res.writeHead(200, {
                "Content-Type": mime,
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
              });
              res.end(content);
            } else {
              res.writeHead(404);
              res.end("Not found");
            }
            return;
          }

          // External URL - not available offline
          res.writeHead(404);
          res.end("Not found");
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }
    }

    // Handle Next.js image URLs with query params in path (e.g., /images/xxx.png&w=3840&q=75)
    // These come from Next.js img components that weren't fully rewritten
    const imgQueryMatch = pathname.match(/^(\/images\/.+?)&w=\d+&q=\d+$/);
    if (imgQueryMatch) {
      const cleanPath = imgQueryMatch[1];
      const filePath = path.join(outputDir, cleanPath);
      const resolved = path.resolve(filePath);
      const outputResolved = path.resolve(outputDir);
      if (resolved.startsWith(outputResolved) && fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath);
        const mime = getMimeType(filePath);
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000",
        });
        res.end(content);
        return;
      }
    }

    // Serve empty responses for non-critical scripts that don't exist locally
    // These would cause console errors but don't affect functionality
    if (pathname === "/triple-pixel.js" ||
        pathname === "/_vercel/insights/script.js" ||
        pathname === "/_vercel/speed-insights/script.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end("");
      return;
    }

    // _clientMiddlewareManifest.json is optional - Next.js continues without it
    if (pathname.endsWith("_clientMiddlewareManifest.json")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }

    // Proxy wallpaper images from live site (removed for offline support)
    if (pathname.startsWith("/static.baggu.com/")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Handle Next.js static assets (_next/static/chunks/, _next/static/css/, _next/static/{buildId}/, etc.)
    if (pathname.startsWith("/_next/static/")) {
      // Strip query string and look directly in outputDir/_next/...
      const nextFilePath = path.join(outputDir, pathname.split("?")[0]);
      const nextResolved = path.resolve(nextFilePath);
      const outputResolved = path.resolve(outputDir);
      if (nextResolved.startsWith(outputResolved) && fs.existsSync(nextFilePath)) {
        const content = fs.readFileSync(nextFilePath);
        const mime = getMimeType(nextFilePath);
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000",
        });
        res.end(content);
        return;
      }

      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Serve static files
    let filePath = path.join(outputDir, pathname);

    // Security: prevent directory traversal
    const resolved = path.resolve(filePath);
    const outputResolved = path.resolve(outputDir);
    if (!resolved.startsWith(outputResolved)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        // File doesn't exist - try adding .html for route-based URLs
        // e.g., /faq -> /faq.html, /collections/best-sellers -> /collections/best-sellers.html
        if (!path.extname(pathname)) {
          const htmlPath = filePath + ".html";
          if (fs.existsSync(htmlPath)) {
            filePath = htmlPath;
            stat = fs.statSync(filePath);
          } else {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
        } else {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
      }

      if (stat.isDirectory()) {
        // Try index.html
        const indexPath = path.join(filePath, "index.html");
        if (fs.existsSync(indexPath)) {
          filePath = indexPath;
        } else {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const content = fs.readFileSync(filePath);
      const mime = getMimeType(filePath);

      const headers: Record<string, string> = {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000",
      };

      // Add CORS headers for fonts
      if (isFont(pathname)) {
        headers["Access-Control-Allow-Origin"] = "*";
      }

      res.writeHead(200, headers);
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve, reject) => {
    server!.listen(port, () => {
      const serverUrl = `http://localhost:${port}`;
      console.log(`  Server running at ${serverUrl}`);
      console.log(`  Press Ctrl+C to stop`);
      resolve({ port, url: serverUrl });
    });
    server!.on("error", reject);
  });
}

/**
 * Stop the server
 */
export function stopServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
