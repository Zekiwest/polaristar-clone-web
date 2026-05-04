---
name: src_dir
description: GEB L2 索引 - src 目录模块说明
type: project
---

# src/ - 源代码目录

> ⚠️ **本文件夹内容变更时必须同步更新本 _dir.md**

## 目录目的

存放 Polaristar CLI 的所有 TypeScript 源代码，编译后输出到 `dist/`。

## 模块清单

| 文件 | 职责 | 输入 | 输出 |
|------|------|------|------|
| `cli.ts` | CLI 入口点 | 命令行参数 | 执行对应模块 |
| `index.ts` | 资源收集核心 | URL + 配置 | 下载的 HTML + 资源 |
| `fetcher.ts` | HTTP 请求 | URL + headers | HTML/Buffer |
| `browser-fetcher.ts` | 浏览器模式 | URL | HTML (绕过 CF) |
| `cloudflare-bypass.ts` | TLS 指纹伪装 | URL | HTML |
| `extractor.ts` | 资源提取 | HTML | URL 列表 |
| `rewriter.ts` | 路径重写 | HTML/CSS | 本地路径 HTML/CSS |
| `url-utils.ts` | URL 工具 | URL | 解析/规范化结果 |
| `crawl.ts` | 网站爬取 | URL + 配置 | 多页 HTML |
| `analyze.ts` | 网站分析 | URL/目录 | 路由/导航列表 |
| `fix.ts` | 链接修复 | HTML 目录 | 修复后的 HTML |
| `server.ts` | HTTP 服务器 | 目录路径 | localhost 服务 |
| `template.ts` | 模板系统 | HTML | config JSON |
| `auth.ts` | 认证系统 | API key | 订阅状态 |

## 核心数据流

```
cli.ts → index.ts → fetcher.ts → extractor.ts → rewriter.ts
                ↓
         browser-fetcher.ts → extractor.ts → rewriter.ts
                ↓
         cloudflare-bypass.ts → extractor.ts → rewriter.ts
```

## 依赖关系

- **所有模块** → `url-utils.ts` (URL 处理)
- **HTML 处理模块** → `cheerio` (DOM 解析)
- **index.ts** → `fetcher.ts`, `browser-fetcher.ts`, `cloudflare-bypass.ts`, `extractor.ts`, `rewriter.ts`
- `cli.ts` → 所有其他模块

## GEB 自指规则

当新增/删除模块时：
1. 更新本文件模块清单
2. 更新 PROJECT_INDEX.md 依赖图
3. 为新文件添加 L3 自指注释块

---

**创建日期**: 2026-04-22