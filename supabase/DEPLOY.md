# Polaristar CLI - Supabase 部署指南

本文档指导你在 Supabase 上部署订阅验证系统。

## 目录结构

```
supabase/
├── schema.sql              # 数据库表结构
├── config.toml             # Supabase 项目配置
└── functions/
    ├── verify-subscription/ # 验证订阅 API
    ├── report-usage/        # 报告使用量 API
    └── create-api-key/      # 创建 API Key API
```

## 部署步骤

### 1. 创建 Supabase 项目

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 创建新项目
3. 记录以下信息：
   - Project URL: `https://xxx.supabase.co`
   - Anon Key: `eyJhbGciOiJIUzI1NiIs...`
   - Service Role Key: `eyJhbGciOiJIUzI1NiIs...`

### 2. 执行数据库 Schema

在 Supabase Dashboard 的 **SQL Editor** 中执行：

```bash
# 复制 schema.sql 内容
cp supabase/schema.sql
```

粘贴并运行 `schema.sql` 的全部内容。

### 3. 配置 OAuth（可选）

如果需要 GitHub/Google 登录：

1. 进入 **Authentication > Providers**
2. 启用 GitHub 或 Google
3. 配置 OAuth Client ID 和 Secret

### 4. 部署 Edge Functions

安装 Supabase CLI：

```bash
npm install -g supabase
```

登录并链接项目：

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

部署函数：

```bash
supabase functions deploy verify-subscription
supabase functions deploy report-usage
supabase functions deploy create-api-key
```

### 5. 配置环境变量

在 Supabase Dashboard 的 **Settings > Edge Functions** 中添加：

| 变量名 | 值 |
|--------|------|
| `SUPABASE_URL` | 你的项目 URL |
| `SUPABASE_ANON_KEY` | 你的 Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | 你的 Service Role Key |

### 6. 配置 Stripe（付费订阅）

如果使用 Stripe 处理付费：

1. 创建 Stripe 账户
2. 创建产品和价格：
   ```
   Basic: $19/月
   Pro: $49/月
   Enterprise: $199/月
   ```
3. 配置 Webhook 指向：`https://<project>.supabase.co/functions/v1/stripe-webhook`

### 7. 更新 CLI 配置

修改 `src/auth.ts` 中的默认配置：

```typescript
const defaultConfig: SubscriptionConfig = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "your-anon-key",
  apiKey,
  machineId: getMachineId(),
};
```

或者通过环境变量：

```bash
export POLARISTAR_SUPABASE_URL="https://your-project.supabase.co"
export POLARISTAR_SUPABASE_ANON_KEY="your-anon-key"
```

## API 接口说明

### verify-subscription

验证用户订阅状态。

**请求：**
```http
POST /functions/v1/verify-subscription
Headers:
  X-Api-Key: <user-api-key>
  X-Machine-Id: <machine-id>
```

**响应：**
```json
{
  "active": true,
  "tier": "pro",
  "expiresAt": "2025-12-31T00:00:00Z",
  "pageLimit": 500,
  "pagesUsed": 42,
  "daysRemaining": 180
}
```

### report-usage

上报使用量。

**请求：**
```http
POST /functions/v1/report-usage
Headers:
  X-Api-Key: <user-api-key>
  X-Machine-Id: <machine-id>
Body:
  {
    "pages": 5,
    "command": "collect",
    "metadata": { "url": "https://example.com" }
  }
```

**响应：**
```json
{
  "success": true,
  "pagesRecorded": 5,
  "currentUsage": 47,
  "limit": 500,
  "remaining": 453
}
```

### create-api-key

创建新的 API Key（用户登录后调用）。

**请求：**
```http
POST /functions/v1/create-api-key
Headers:
  Authorization: Bearer <supabase-auth-token>
Body:
  {
    "name": "My API Key"
  }
```

**响应：**
```json
{
  "success": true,
  "apiKey": "pk_a1b2c3d4...",
  "keyPrefix": "pk_a1b2c3",
  "name": "My API Key",
  "message": "Store this key securely. It will not be shown again."
}
```

## 用户流程

### 新用户注册

```
1. 用户访问 polaristar.com 注册账号
2. Supabase Auth 创建用户（触发 handle_new_user）
3. 自动创建 free 订阅
4. 用户在 Dashboard 创建 API Key
5. CLI: polaristar login <api-key>
```

### 用户付费升级

```
1. 用户在 polaristar.com 选择付费方案
2. Stripe 处理支付
3. Stripe Webhook 更新 subscriptions 表
4. CLI 下次运行时自动获得新权限
```

## 定价方案

| 等级 | 价格 | 页面限制 | 可用命令 |
|------|------|----------|----------|
| Free | $0 | 10 页/月 | collect, serve, login, status |
| Basic | $19/月 | 50 页/月 | + crawl, analyze |
| Pro | $49/月 | 500 页/月 | + fix, template |
| Enterprise | $199/月 | 无限制 | 全功能 + batch, API |

## 常见问题

### Q: 用户忘记 API Key？

用户可以在 polaristar.com Dashboard 查看现有 Key 的前缀，但无法恢复完整 Key。需要重新创建。

### Q: 如何处理设备限制？

每个 API Key 默认绑定最多 3 台设备。用户可以：
- 在 Dashboard 查看已绑定设备
- 申请增加设备限制（Enterprise 用户）

### Q: 如何查看使用统计？

用户可以在 polaristar.com Dashboard 查看月度使用量统计。

---

## 部署完成检查清单

- [ ] 创建 Supabase 项目
- [ ] 执行 schema.sql
- [ ] 部署 Edge Functions
- [ ] 配置环境变量
- [ ] 配置 OAuth（可选）
- [ ] 配置 Stripe（可选）
- [ ] 更新 CLI 默认配置
- [ ] 测试 verify-subscription API
- [ ] 测试 CLI login/status 命令