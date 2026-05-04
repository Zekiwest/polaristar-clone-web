-- Polaristar CLI Subscription System - Supabase Database Schema
-- Run this in Supabase SQL Editor
--
-- ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
-- 文件作用: 定义用户、订阅、API Key、用量日志数据库表结构
-- 依赖关系: supabase/functions (Edge Functions 使用本 Schema)
-- 变更同步: 修改表结构时更新 supabase/_dir.md 架构图和 PROJECT_INDEX.md
-- ──────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. USERS TABLE (synced with Supabase Auth)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = id);

-- ============================================================================
-- 2. API KEYS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of the API key
  key_prefix TEXT NOT NULL, -- First 8 chars for identification
  name TEXT DEFAULT 'Default Key',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  machine_ids TEXT[] DEFAULT '{}', -- Bound machine IDs
  max_machines INTEGER DEFAULT 3 -- Max devices per key
);

-- Enable RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own keys
CREATE POLICY "api_keys_select_own" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "api_keys_insert_own" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "api_keys_update_own" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "api_keys_delete_own" ON api_keys
  FOR DELETE USING (auth.uid() = user_id);

-- Index for fast key lookup
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

-- ============================================================================
-- 3. SUBSCRIPTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'basic', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
  stripe_subscription_id TEXT, -- Stripe subscription ID if using Stripe
  stripe_customer_id TEXT, -- Stripe customer ID
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "subscriptions_insert_own" ON subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "subscriptions_update_own" ON subscriptions
  FOR UPDATE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_current_period_end ON subscriptions(current_period_end);

-- ============================================================================
-- 4. USAGE LOGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  machine_id TEXT NOT NULL,
  command TEXT NOT NULL,
  pages INTEGER DEFAULT 1,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}' -- Additional info (URL, outputDir, etc.)
);

-- Enable RLS
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_logs_select_own" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "usage_logs_insert_own" ON usage_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes for analytics
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_logs_machine_id ON usage_logs(machine_id);

-- ============================================================================
-- 5. TIER LIMITS TABLE (configuration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tier_limits (
  tier TEXT PRIMARY KEY CHECK (tier IN ('free', 'basic', 'pro', 'enterprise')),
  page_limit INTEGER NOT NULL, -- Monthly page limit (-1 for unlimited)
  price_monthly DECIMAL(10,2), -- Monthly price in USD
  price_yearly DECIMAL(10,2), -- Yearly price in USD
  features JSONB DEFAULT '{}' -- Feature flags
);

-- Insert default tier limits
INSERT INTO tier_limits (tier, page_limit, price_monthly, price_yearly, features) VALUES
  ('free', 10, 0, 0, '{"commands": ["collect", "serve", "login", "status", "help"]}'::jsonb),
  ('basic', 50, 19, 190, '{"commands": ["collect", "serve", "crawl", "analyze", "login", "status", "help"]}'::jsonb),
  ('pro', 500, 49, 490, '{"commands": ["collect", "serve", "crawl", "analyze", "fix", "template", "login", "status", "help"]}'::jsonb),
  ('enterprise', -1, 199, 1990, '{"commands": ["collect", "serve", "crawl", "analyze", "fix", "template", "batch", "api", "login", "status", "help"]}'::jsonb)
ON CONFLICT (tier) DO NOTHING;

-- ============================================================================
-- 6. FUNCTIONS
-- ============================================================================

-- Function to get user's current subscription
CREATE OR REPLACE FUNCTION get_user_subscription(user_uuid UUID)
RETURNS TABLE (
  tier TEXT,
  status TEXT,
  page_limit INTEGER,
  pages_used INTEGER,
  current_period_end TIMESTAMPTZ,
  days_remaining INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.tier,
    s.status,
    tl.page_limit,
    COALESCE(
      (SELECT SUM(pages) FROM usage_logs
       WHERE user_id = user_uuid
       AND timestamp >= date_trunc('month', NOW())
       AND timestamp < date_trunc('month', NOW()) + INTERVAL '1 month'),
      0
    ) as pages_used,
    s.current_period_end,
    CASE
      WHEN s.current_period_end IS NOT NULL
      THEN EXTRACT(DAY FROM (s.current_period_end - NOW()))::INTEGER
      ELSE NULL
    END as days_remaining
  FROM subscriptions s
  JOIN tier_limits tl ON tl.tier = s.tier
  WHERE s.user_id = user_uuid
    AND s.status = 'active'
    AND s.current_period_end > NOW()
  ORDER BY s.current_period_end DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if API key is valid
CREATE OR REPLACE FUNCTION verify_api_key(
  key_hash_input TEXT,
  machine_id_input TEXT
)
RETURNS TABLE (
  user_id UUID,
  tier TEXT,
  page_limit INTEGER,
  pages_used INTEGER,
  expires_at TIMESTAMPTZ,
  machine_bound BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ak.user_id,
    s.tier,
    tl.page_limit,
    COALESCE(
      (SELECT SUM(pages) FROM usage_logs
       WHERE user_id = ak.user_id
       AND timestamp >= date_trunc('month', NOW())),
      0
    ) as pages_used,
    s.current_period_end as expires_at,
    (machine_id_input = ANY(ak.machine_ids) OR array_length(ak.machine_ids, 1) IS NULL) as machine_bound
  FROM api_keys ak
  JOIN subscriptions s ON s.user_id = ak.user_id AND s.status = 'active' AND s.current_period_end > NOW()
  JOIN tier_limits tl ON tl.tier = s.tier
  WHERE ak.key_hash = key_hash_input
    AND ak.is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. TRIGGERS
-- ============================================================================

-- Trigger to create user record on auth signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email)
  VALUES (NEW.id, NEW.email);

  -- Create free subscription
  INSERT INTO subscriptions (user_id, tier, status, current_period_start, current_period_end)
  VALUES (NEW.id, 'free', 'active', NOW(), NOW() + INTERVAL '100 years');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Trigger to update timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================================
-- 8. GRANT PERMISSIONS FOR EDGE FUNCTIONS
-- ============================================================================

-- Edge Functions need service role access
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ============================================================================
-- DONE! Run this SQL and then deploy Edge Functions
-- ============================================================================