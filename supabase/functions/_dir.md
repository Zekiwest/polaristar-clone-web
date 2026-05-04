---
name: supabase_functions_dir
description: GEB L2 索引 - Supabase Edge Functions
type: project
---

# supabase/functions/ - Edge Functions

> ⚠️ **本文件夹内容变更时必须同步更新本 _dir.md**

## 目录目的

存放 Supabase Edge Functions，用于 CLI 订阅验证和使用量报告。

## 函数清单

| 函数目录 | 职责 | 输入 | 输出 |
|----------|------|------|------|
| `verify-subscription/` | 验证订阅 | API key + machine ID | tier + page_limit + pages_used |
| `report-usage/` | 报告用量 | pages + command | success/error |
| `create-api-key/` | 创建 Key | user auth | API key |

## 函数调用流程

```mermaid
sequenceDiagram
    CLI:auth.ts->>verify-subscription: POST (API key + machine ID)
    verify-subscription->>Database: 查询 api_keys + subscriptions
    Database-->>verify-subscription: tier + limits
    verify-subscription-->>CLI:auth.ts: JSON {active, tier, pageLimit}
    
    CLI:auth.ts->>report-usage: POST (pages + command)
    report-usage->>Database: INSERT usage_logs
    Database-->>report-usage: success
    report-usage-->>CLI:auth.ts: boolean
```

## 与 src/auth.ts 的关系

Edge Functions 是 `src/auth.ts` 中以下函数的后端实现：
- `checkSubscription()` → `verify-subscription`
- `reportUsage()` → `report-usage`

## GEB 自指规则

当新增/修改 Edge Function 时：
1. 更新本文件函数清单
2. 更新 `supabase/_dir.md` Edge Functions 表
3. 更新 `src/auth.ts` L3 注释依赖说明

---

**创建日期**: 2026-04-22