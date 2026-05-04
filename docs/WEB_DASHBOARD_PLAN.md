# Polaristar Web Dashboard - 前端计划

> 用户订阅管理前端，对接 Supabase 认证系统

## 技术栈

| 技术 | 用途 | 理由 |
|------|------|------|
| Next.js 14 | 框架 | App Router、SSR、SEO |
| Tailwind CSS | 样式 | 快速开发、响应式 |
| Supabase Auth | 认证 | OAuth + JWT |
| Stripe | 支付 | 订阅计费 |

## 页面规划

### 1. 首页 `/`
- 产品介绍
- 定价方案展示
- CTA 按钮 (开始使用)

### 2. 登录页 `/login`
- GitHub OAuth 按钮
- Google OAuth 按钮
- Email/Password 登录

### 3. Dashboard `/dashboard`
- **订阅状态卡片**
  - 当前等级、到期时间
  - 月度使用量进度条
  - 升级按钮
- **API Key 管理**
  - 创建新 Key
  - Key 列表 (仅显示前缀)
  - 绑定设备数
  - 删除/停用
- **使用历史**
  - 按命令分类统计
  - 时间线图表

### 4. 定价页 `/pricing`
- 4 个等级对比卡片
- FAQ
- 联系支持

## 组件结构

```
src/
├── app/
│   ├── page.tsx              # 首页
│   ├── login/page.tsx        # 登录页
│   ├── dashboard/page.tsx    # Dashboard
│   ├── pricing/page.tsx      # 定价页
│   └── layout.tsx            # 全局布局
├── components/
│   ├── auth/
│   │   ├── LoginButton.tsx   # OAuth 登录按钮
│   │   └── UserAvatar.tsx    # 用户头像
│   ├── dashboard/
│   │   ├── SubscriptionCard.tsx
│   │   ├── ApiKeyTable.tsx
│   │   ├── UsageChart.tsx
│   │   └── CreateKeyModal.tsx
│   ├── pricing/
│   │   └── PricingCard.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Modal.tsx
│       └── Progress.tsx
├── lib/
│   ├── supabase.ts           # Supabase 客户端
│   ├── stripe.ts             # Stripe 客户端
│   └── api.ts                # API 调用封装
└── hooks/
    ├── useUser.ts            # 用户状态
    ├── useApiKeys.ts         # API Key 管理
    └── useUsage.ts           # 使用量统计
```

## API 对接

### 登录流程
```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// hooks/useUser.ts
const { data: { user } } = await supabase.auth.getUser()
```

### 创建 API Key
```typescript
// 登录后调用 Edge Function
const response = await fetch('/api/create-key', {
  method: 'POST',
  headers: { Authorization: `Bearer ${session.access_token}` },
  body: JSON.stringify({ name: 'My Key' })
})
const { apiKey } = await response.json()
```

### 查看订阅状态
```typescript
// 调用 verify-subscription
const status = await fetch('/api/subscription', {
  headers: { 'X-Api-Key': userKey }
})
```

## Stripe 集成

### Webhook 处理
```
POST /api/stripe-webhook
├── checkout.session.completed → 创建订阅
├── customer.subscription.updated → 更新等级
├── customer.subscription.deleted → 取消订阅
```

### 订阅流程
1. 用户点击升级 → Stripe Checkout
2. 支付成功 → Webhook 更新 `subscriptions` 表
3. CLI 下次运行自动获得新权限

## UI 设计参考

### 调色板
| 颜色 | 用途 |
|------|------|
| `#6366f1` (Indigo) | 主色、按钮 |
| `#1e1b4b` (Dark Indigo) | 深色背景 |
| `#f8fafc` (Slate 50) | 浅色背景 |
| `#22c55e` (Green) | 成功状态 |
| `#ef4444` (Red) | 错误/警告 |

### 排版
- 字体: Inter (系统默认)
- 标题: 2xl/3xl/4xl
- 正文: base/lg

## 开发步骤

### Phase 1: 基础框架 (Day 1-2)
1. 创建 Next.js 项目
2. 配置 Tailwind
3. 设置 Supabase 客户端
4. 实现登录页

### Phase 2: Dashboard 核心 (Day 3-4)
5. Dashboard 布局
6. SubscriptionCard 组件
7. ApiKeyTable 组件
8. CreateKeyModal 组件

### Phase 3: 支付集成 (Day 5-6)
9. Stripe Checkout 页面
10. Webhook API
11. 定价页

### Phase 4: 优化部署 (Day 7)
12. 响应式适配
13. SEO 优化
14. Vercel 部署

## 部署配置

### Vercel 环境变量
```
NEXT_PUBLIC_SUPABASE_URL=https://mgrfrcltyusleljojzql.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 域名
- 生产: `polaristar.com`
- 预览: `polaristar.vercel.app`

---

**创建日期**: 2026-05-04
**状态**: 计划阶段