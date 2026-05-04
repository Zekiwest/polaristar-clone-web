# Polaristar CLI - Claude Code 项目指南

> 本文件为 Claude Code 提供项目上下文和工作规范

## 项目概述

Polaristar CLI 是一个专业的网站资源收集工具，支持：
- Cloudflare Turnstile 绕过
- 多页网站爬取
- 离线站点重构
- 订阅认证系统 (Supabase)

## 构建与运行

```bash
npm run build   # 编译 TypeScript → dist/
npm run dev     # 开发模式 (tsx)
npm run start   # 运行 CLI
```

## CLI 命令速览

| 命令 | 用法示例 |
|------|----------|
| collect | `npx polaristar <url> -o ./output` |
| crawl | `npx polaristar crawl <url> -d 2 -m 50` |
| analyze | `npx polaristar analyze <url>` |
| fix | `npx polaristar fix ./output --base-url https://example.com` |
| serve | `npx polaristar serve ./output -p 3000` |

---

## GEB 分形文档系统 (永久规则)

本项目采用 **GEB 分形文档系统** 实现代码与文档的同构自维护。

### 三级索引结构

| 层级 | 文件 | 作用 |
|------|------|------|
| L1 | `PROJECT_INDEX.md` | 项目整体架构、依赖图、命令表 |
| L2 | `src/_dir.md`, `supabase/_dir.md` 等 | 目录级模块清单、输入/输出关系 |
| L3 | 源文件头部自指注释块 | 文件作用、依赖关系、变更同步提示 |

### GEB 永久规则

**当进行任何代码变更时，Claude Code 必须遵守以下规则：**

#### 规则 1: 结构变更 → 更新索引

```
IF 新增/删除/重命名 模块文件:
  THEN 更新 PROJECT_INDEX.md 结构表 + 对应 _dir.md 模块清单
```

#### 规则 2: 依赖变更 → 更新依赖图

```
IF 修改模块间的 import/调用关系:
  THEN 更新 PROJECT_INDEX.md Mermaid 依赖图 + _dir.md 数据流
```

#### 规规则 3: 功能变更 → 检查文档同步

```
IF 修改核心功能逻辑:
  THEN 检查 docs/ 相关文档 + L3 注释是否需要更新
```

#### 规则 4: 新增文件 → 添加 L3 注释

```
IF 创建新的 .ts/.js/.sql/.md 文件:
  THEN 在文件头部添加标准 L3 自指注释块:

  格式:
  /**
   * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
   * 文件作用: <描述>
   * 依赖关系: <列出依赖的模块/包>
   * 变更同步: <变更时需要同步更新的文件>
   * ──────────────────────────────────────────────────────────────────────────
   */
```

#### 规则 5: 验证检查

```
运行 /geb-check 验证 GEB 系统一致性:
  - 检查所有 _dir.md 文件存在且内容正确
  - 检查所有源文件有 L3 注释
  - 检查依赖图与实际 import 一致
```

### 自指声明

本文件描述 GEB 规则，规则本身由本文件定义——形成奇异循环。

---

## 技术栈快速参考

| 技术 | 用途 |
|------|------|
| puppeteer-real-browser | Cloudflare 绕过 |
| undici | HTTP 客户端 |
| got-scraping | TLS 指纹伪装 |
| cheerio | HTML 解析 |
| commander | CLI 框架 |
| Supabase | 认证系统 |

---

## Supabase 订阅系统

### 项目配置

| 属性 | 值 |
|------|------|
| 项目名称 | polaristar |
| 项目 ID | mgrfrcltyusleljojzql |
| 区域 | ap-southeast-1 (新加坡) |
| URL | `https://mgrfrcltyusleljojzql.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/mgrfrcltyusleljojzql |

### 已部署组件

| 组件 | 状态 | 说明 |
|------|------|------|
| 数据库表 | ✅ | users, api_keys, subscriptions, usage_logs, tier_limits |
| Edge Functions | ✅ | verify-subscription, report-usage, create-api-key |
| RLS 策略 | ✅ | 所有用户表启用 |
| 触发器 | ✅ | 新用户自动创建 free 订阅 |

### 订阅等级

| 等级 | 页数/月 | 价格 | 可用命令 |
|------|--------|------|----------|
| Free | 10 | $0 | collect, serve, login, status |
| Basic | 50 | $19 | + crawl, analyze |
| Pro | 500 | $49 | + fix, template |
| Enterprise | ∞ | $199 | + batch, api |

---

## Web Dashboard 计划

详见 [docs/WEB_DASHBOARD_PLAN.md](docs/WEB_DASHBOARD_PLAN.md)

**技术栈**: Next.js 14 + Tailwind + Supabase Auth + Stripe

**页面规划**:
- `/` 首页 (产品介绍)
- `/login` OAuth 登录
- `/dashboard` API Key 管理、使用量统计
- `/pricing` 定价页

**待开发**: Phase 1-4 (约 7 天)

---

**创建日期**: 2026-04-22
**GEB 版本**: 1.0.0
**订阅系统部署日期**: 2026-05-04