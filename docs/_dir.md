---
name: docs_dir
description: GEB L2 索引 - 文档目录
type: project
---

# docs/ - 文档目录

> ⚠️ **本文件夹内容变更时必须同步更新本 _dir.md**

## 目录目的

存放项目技术文档，补充代码注释无法覆盖的复杂实现细节。

## 文件清单

| 文件 | 内容 | 对应模块 |
|------|------|----------|
| `CLOUDFLARE_BYPASS.md` | Cloudflare 绕过技术详解 | `browser-fetcher.ts`, `cloudflare-bypass.ts` |

## 文档与代码的关系

文档描述技术原理，代码实现具体逻辑。当代码变更时，需检查相关文档是否需要更新。

## GEB 自指规则

当新增/删除文档时：
1. 更新本文件清单
2. 更新 PROJECT_INDEX.md 结构

---

**创建日期**: 2026-04-22