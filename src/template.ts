/**
 * Template Extractor - Extracts customizable config from cloned HTML
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 提取站点模板配置（颜色、导航、社交链接等）
 * 依赖关系: cheerio
 * 变更同步: 修改提取字段时更新 PROJECT_INDEX.md 命令表和 src/_dir.md
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as cheerio from "cheerio";

export interface TemplateConfig {
  /** Site metadata */
  meta: {
    title: string;
    description: string;
    keywords: string;
    favicon: string;
    canonicalUrl: string;
  };
  /** Open Graph / Social */
  social: {
    ogSiteName: string;
    ogTitle: string;
    ogDescription: string;
    ogImage: string;
    twitterHandle: string;
  };
  /** Brand colors (CSS custom properties from :root or html style) */
  colors: {
    background: string;
    text: string;
    accent: string;
  };
  /** Social media links */
  socialLinks: Record<string, string>;
  /** Navigation links (text -> URL) */
  navigation: Array<{ text: string; url: string }>;
  /** Image file mappings (original URL -> local filename) */
  images: Array<{
    url: string;
    localPath: string;
    type: "logo" | "product" | "banner" | "background" | "icon" | "other";
  }>;
  /** Font files */
  fonts: string[];
}

/**
 * Extract template configuration from collected HTML
 */
export function extractTemplateConfig(
  html: string,
  outputDir: string
): TemplateConfig {
  const $ = cheerio.load(html);

  // Extract meta info
  const title = $('meta[data-next-head=""]').first().attr("content") || $("title").text();
  const description = $('meta[name="description"]').attr("content") || "";
  const keywords = $('meta[name="keywords"]').attr("content") || "";
  const favicon = $('link[rel="shortcut icon"]').attr("href") || "";
  const canonicalUrl = $('meta[property="og:url"]').attr("content") || "";

  // Extract social meta
  const ogSiteName = $('meta[property="og:site_name"]').attr("content") || "";
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDescription = $('meta[property="og:description"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  const twitterHandle = $('meta[name="twitter:site"]').attr("content") || "";

  // Extract colors from inline style on <html>
  const htmlStyle = $("html").attr("style") || "";
  const colors = {
    background: extractCssVar(htmlStyle, "--bg") || "#ffffff",
    text: extractCssVar(htmlStyle, "--text") || "#000000",
    accent: extractCssVar(htmlStyle, "--accent") || "#000000",
  };

  // Extract social links
  const socialLinks: Record<string, string> = {};
  $('a[href*="instagram.com"], a[href*="tiktok.com"], a[href*="facebook.com"], a[href*="twitter.com"], a[href*="youtube.com"], a[href*="pinterest.com"]').each(
    (_, el) => {
      const href = $(el).attr("href");
      if (href) {
        const domain = new URL(href).hostname.replace("www.", "").replace(".com", "");
        socialLinks[domain] = href;
      }
    }
  );

  // Extract navigation
  const navigation: Array<{ text: string; url: string }> = [];
  $("nav a, header a, .nav a, .header a").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && text && !href.startsWith("data:")) {
      navigation.push({ text, url: href });
    }
  });

  // Extract images and categorize them
  const images: TemplateConfig["images"] = [];
  const seenUrls = new Set<string>();

  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (!src || seenUrls.has(src)) return;
    seenUrls.add(src);

    images.push({
      url: src,
      localPath: getLocalPath(src),
      type: categorizeImage(src, $(el)),
    });
  });

  // Extract fonts from preload links
  const fonts: string[] = [];
  $('link[rel="preload"][as="font"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) fonts.push(href);
  });

  return {
    meta: { title, description, keywords, favicon, canonicalUrl },
    social: { ogSiteName, ogTitle, ogDescription, ogImage, twitterHandle },
    colors,
    socialLinks,
    navigation,
    images,
    fonts,
  };
}

/**
 * Apply template config to HTML, replacing values
 */
export function applyTemplateConfig(
  html: string,
  config: Partial<TemplateConfig>
): string {
  let result = html;

  // Replace title
  if (config.meta?.title) {
    result = result.replace(
      /<title[^>]*>.*?<\/title>/g,
      `<title>${escapeHtml(config.meta.title)}</title>`
    );
  }

  // Replace meta description
  if (config.meta?.description) {
    result = result.replace(
      /(<meta\s+name="description"[^>]*content=")[^"]*"/g,
      `$1${escapeHtml(config.meta.description)}"`
    );
  }

  // Replace colors
  if (config.colors) {
    result = result.replace(
      /style="--bg:[^;]+;--text:[^;]+;--accent:[^"]+"/g,
      (match) => {
        const bg = config.colors?.background;
        const text = config.colors?.text;
        const accent = config.colors?.accent;
        if (bg && text && accent) {
          return `style="--bg:${bg};--text:${text};--accent:${accent}"`;
        }
        return match;
      }
    );
  }

  return result;
}

function extractCssVar(style: string, name: string): string | null {
  const match = style.match(new RegExp(`${name}:([^;]+)`));
  return match?.[1].trim() || null;
}

function getLocalPath(url: string): string {
  if (url.startsWith("data:") || url.startsWith("#")) return url;
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.split("/").pop() || url;
  } catch {
    return url;
  }
}

function categorizeImage(url: string, el: cheerio.Cheerio<any>): TemplateConfig["images"][number]["type"] {
  const src = url.toLowerCase();
  const parentClasses = el.parent().attr("class") || "";

  if (src.includes("logo") || src.includes("brand") || parentClasses.includes("logo")) return "logo";
  if (src.includes("banner") || src.includes("hero") || src.includes("header")) return "banner";
  if (src.includes("product") || src.includes("item") || src.includes("shop")) return "product";
  if (src.includes("icon") || src.includes("badge") || src.includes("flag")) return "icon";
  if (src.includes("bg") || src.includes("background")) return "background";
  return "other";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
