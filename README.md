# Polaristar CLI

Professional website resource collector with Cloudflare bypass, site crawling, and offline reconstruction.

## Features

- **Complete Resource Extraction**: Downloads images, CSS, JS, and fonts from any webpage
- **Path Rewriting**: Automatically converts all resource URLs to local paths for offline viewing
- **Cloudflare Bypass**: Uses `puppeteer-real-browser` to bypass Cloudflare Turnstile protection
- **Site Crawling**: Multi-page crawling with depth and page limit control
- **Website Analysis**: Extract navigation links, routes, and site structure
- **Link Fixing**: Repair broken links, CDN URLs, and font references
- **Local Preview**: Built-in HTTP server for offline preview
- **Template System**: Extract and customize site templates

## Installation

```bash
npm install polaristar-cli
```

Or use directly with npx:

```bash
npx polaristar <url> -o ./output
```

## Commands

### collect (default)

Collect resources from a single webpage:

```bash
polaristar <url> -o ./output
```

Options:
- `-o, --output <dir>` - Output directory
- `--no-images` - Skip downloading images
- `--no-css` - Skip downloading CSS
- `--no-js` - Skip downloading JavaScript
- `-c, --concurrency <number>` - Concurrent downloads (default: 5)
- `-t, --timeout <ms>` - Request timeout (default: 30000)
- `-H, --header <header>` - Custom headers
- `--browser` - Force browser mode
- `--wait-for <selector>` - Wait for selector before extracting
- `-s, --serve [port]` - Start server after collecting

### crawl

Crawl and download entire website:

```bash
polaristar crawl <url> -o ./output -d 2 -m 50
```

Options:
- `-o, --output <dir>` - Output directory
- `-d, --depth <number>` - Maximum crawl depth (default: 2)
- `-m, --max-pages <number>` - Maximum pages (default: 50)
- `--include <pattern>` - Include pattern (regex)
- `--exclude <pattern>` - Exclude pattern (regex)
- `--no-browser` - Disable browser mode
- `--no-assets` - Skip asset downloads
- `-t, --timeout <ms>` - Request timeout

### analyze

Analyze website structure:

```bash
polaristar analyze <url>
polaristar analyze ./output  # Analyze local files
```

Options:
- `--no-browser` - Disable browser mode
- `--nav` - Show navigation only
- `--routes` - Show routes only
- `--collections` - Show collections only
- `--products` - Show products only
- `-o, --output <file>` - Save to JSON file

### fix

Fix broken links in downloaded files:

```bash
polaristar fix ./output --base-url https://example.com
```

Options:
- `--links` - Fix internal links
- `--cdn` - Fix CDN URLs
- `--fonts` - Fix font URLs
- `--base-url <url>` - Original site URL
- `--external <domain>` - External domains to keep

### serve

Preview downloaded site locally:

```bash
polaristar serve ./output -p 3000
```

Options:
- `-p, --port <number>` - Port number (default: 3000)

### template

Template extraction and customization:

```bash
polaristar template extract ./output
polaristar template apply ./output config.json
polaristar template export ./output --dest ./export
```

## Examples

```bash
# Single page with Cloudflare bypass
polaristar https://protected-site.com --browser -o ./output

# Crawl entire site (depth 3, max 100 pages)
polaristar crawl https://example.com -d 3 -m 100 -o ./output

# Analyze site structure
polaristar analyze https://shop.example.com -o analysis.json

# Fix links after download
polaristar fix ./output --base-url https://example.com

# Preview locally
polaristar serve ./output -p 8080
```

## Output Structure

```
output/
├── index.html      # Rewritten HTML
├── images/         # Downloaded images
├── css/            # CSS files
├── js/             # JavaScript files
├── fonts/          # Font files
```

## Tech Stack

- **puppeteer-real-browser** - Cloudflare Turnstile bypass
- **cheerio** - HTML parsing
- **undici** - HTTP client
- **commander** - CLI framework

## License

Proprietary - All rights reserved.