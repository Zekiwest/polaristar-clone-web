# Polaristar Clone Web

A powerful website resource collector that extracts and reconstructs web pages for offline viewing. Capable of downloading HTML, CSS, JavaScript, images, and fonts while rewriting all resource paths for local browsing.

## Features

- **Complete Resource Extraction**: Downloads images, CSS, JS, and fonts from any webpage
- **Path Rewriting**: Automatically converts all resource URLs to local paths for offline viewing
- **Cloudflare Bypass**: Uses `puppeteer-real-browser` to bypass Cloudflare Turnstile protection
- **Browser Mode**: Supports JavaScript-heavy sites with dynamic content rendering
- **TLS Fingerprint Spoofing**: Fallback mechanism using `got-scraping` for anti-bot measures
- **Concurrent Downloads**: Configurable concurrency for faster resource collection
- **CSS Resource Extraction**: Extracts images and fonts referenced within CSS files

## Installation

```bash
npm install
npm run build
```

## Usage

### CLI

```bash
node dist/cli.js <url> [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <dir>` | Output directory | `./output` |
| `--no-images` | Skip downloading images | false |
| `--no-css` | Skip downloading CSS | false |
| `--no-js` | Skip downloading JavaScript | false |
| `-c, --concurrency <number>` | Concurrent downloads | 5 |
| `-t, --timeout <ms>` | Request timeout | 30000 |
| `-H, --header <header>` | Custom headers | - |
| `--user-agent <ua>` | Custom user agent | - |
| `--browser` | Use browser mode (Cloudflare support) | false |
| `--wait-for <selector>` | Wait for selector (browser mode) | - |

### Examples

```bash
# Basic extraction
node dist/cli.js https://example.com -o ./output

# Cloudflare-protected site
node dist/cli.js https://protected-site.com --browser -o ./output

# High concurrency
node dist/cli.js https://example.com -c 10 -o ./output
```

### API

```typescript
import { collectResources } from 'polaristar-clone-web';

const result = await collectResources('https://example.com', {
  outputDir: './output',
  downloadImages: true,
  downloadCss: true,
  downloadJs: true,
  useBrowser: false,
  concurrency: 5,
  timeout: 30000,
});

console.log(result.stats);
```

## Output Structure

```
output/
├── index.html      # Rewritten HTML with local paths
├── images/         # All downloaded images
├── css/            # CSS files (paths rewritten)
├── js/             # JavaScript files
├── fonts/          # Font files
```

## Tech Stack

- **puppeteer-real-browser** - Cloudflare Turnstile bypass
- **cheerio** - HTML parsing and manipulation
- **undici** - High-performance HTTP client
- **got-scraping** - TLS fingerprint spoofing (fallback)
- **commander** - CLI framework

## License

MIT