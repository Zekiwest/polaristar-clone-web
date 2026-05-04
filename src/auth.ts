/**
 * Auth Module - Subscription verification
 * Handles API key validation, subscription status checking
 *
 * ─── GEB L3 自指注释 ─────────────────────────────────────────────────────
 * 文件作用: 订阅认证，API Key 验证，用量报告
 * 依赖关系: supabase/functions (verify-subscription, report-usage)
 * 变更同步: 修改认证流程时同步更新 supabase/_dir.md 和 PROJECT_INDEX.md
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export interface SubscriptionConfig {
  /** Supabase project URL */
  supabaseUrl: string;
  /** Supabase anon key */
  supabaseAnonKey: string;
  /** User's API key (subscription key) */
  apiKey?: string;
  /** Machine ID (for device binding) */
  machineId?: string;
}

export interface SubscriptionStatus {
  /** Is subscription active */
  active: boolean;
  /** Subscription tier */
  tier: "free" | "basic" | "pro" | "enterprise";
  /** Subscription expires at */
  expiresAt?: string;
  /** Usage limit for current tier */
  pageLimit: number;
  /** Pages used this month */
  pagesUsed: number;
  /** Days remaining */
  daysRemaining?: number;
  /** Error message if inactive */
  error?: string;
}

export interface UsageRecord {
  /** Timestamp */
  timestamp: string;
  /** Pages collected */
  pages: number;
  /** Command used */
  command: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".polaristar");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const USAGE_FILE = path.join(CONFIG_DIR, "usage.json");

/**
 * Get or generate machine ID
 */
export function getMachineId(): string {
  const machineIdFile = path.join(CONFIG_DIR, "machine_id");

  if (fs.existsSync(machineIdFile)) {
    return fs.readFileSync(machineIdFile, "utf-8").trim();
  }

  // Generate unique machine ID based on hardware
  const hostname = os.hostname();
  const cpus = os.cpus().map(c => c.model).join(",");
  const platform = os.platform();
  const arch = os.arch();

  const hash = crypto
    .createHash("sha256")
    .update(`${hostname}-${cpus}-${platform}-${arch}`)
    .digest("hex")
    .slice(0, 32);

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(machineIdFile, hash);

  return hash;
}

/**
 * Load user config
 */
export function loadConfig(): SubscriptionConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Save user config
 */
export function saveConfig(config: SubscriptionConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Load usage history
 */
export function loadUsage(): UsageRecord[] {
  if (!fs.existsSync(USAGE_FILE)) {
    return [];
  }

  try {
    const content = fs.readFileSync(USAGE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Save usage record
 */
export function saveUsage(record: UsageRecord): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const usage = loadUsage();
  usage.push(record);
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

/**
 * Get current month usage
 */
export function getCurrentMonthUsage(): number {
  const usage = loadUsage();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  return usage
    .filter(r => {
      const date = new Date(r.timestamp);
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    })
    .reduce((sum, r) => sum + r.pages, 0);
}

/**
 * Check subscription status via Supabase API
 */
export async function checkSubscription(config: SubscriptionConfig): Promise<SubscriptionStatus> {
  const { supabaseUrl, supabaseAnonKey, apiKey, machineId } = config;

  if (!apiKey) {
    return {
      active: false,
      tier: "free",
      pageLimit: 10,
      pagesUsed: 0,
      error: "No API key configured. Run 'polaristar login' first.",
    };
  }

  try {
    // Call Supabase Edge Function to verify subscription
    const response = await fetch(`${supabaseUrl}/functions/v1/verify-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "X-Api-Key": apiKey,
        "X-Machine-Id": machineId || getMachineId(),
      },
      body: JSON.stringify({
        machineId: machineId || getMachineId(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        active: false,
        tier: "free",
        pageLimit: 10,
        pagesUsed: getCurrentMonthUsage(),
        error: `Verification failed: ${response.status} - ${error}`,
      };
    }

    const data = await response.json() as {
      active: boolean;
      tier: SubscriptionStatus["tier"];
      expiresAt?: string;
      pageLimit: number;
      pagesUsed?: number;
      daysRemaining?: number;
    };

    return {
      active: data.active,
      tier: data.tier,
      expiresAt: data.expiresAt,
      pageLimit: data.pageLimit,
      pagesUsed: data.pagesUsed || getCurrentMonthUsage(),
      daysRemaining: data.daysRemaining,
    };
  } catch (error) {
    return {
      active: false,
      tier: "free",
      pageLimit: 10,
      pagesUsed: getCurrentMonthUsage(),
      error: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Report usage to Supabase
 */
export async function reportUsage(
  config: SubscriptionConfig,
  pages: number,
  command: string
): Promise<boolean> {
  const { supabaseUrl, supabaseAnonKey, apiKey, machineId } = config;

  if (!apiKey) {
    return false;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/report-usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "X-Api-Key": apiKey,
        "X-Machine-Id": machineId || getMachineId(),
      },
      body: JSON.stringify({
        pages,
        command,
        machineId: machineId || getMachineId(),
      }),
    });

    if (response.ok) {
      // Also save locally
      saveUsage({
        timestamp: new Date().toISOString(),
        pages,
        command,
      });
      return true;
    }

    return false;
  } catch {
    // Save locally even if remote fails
    saveUsage({
      timestamp: new Date().toISOString(),
      pages,
      command,
    });
    return false;
  }
}

/**
 * Tier limits
 */
export const TIER_LIMITS: Record<string, number> = {
  free: 10,
  basic: 50,
  pro: 500,
  enterprise: -1, // unlimited
};

/**
 * Check if command is allowed for tier
 */
export function isCommandAllowed(command: string, tier: string): boolean {
  const freeCommands = ["collect", "serve", "login", "status", "help"];
  const basicCommands = [...freeCommands];
  const proCommands = [...basicCommands, "crawl", "analyze", "fix", "template"];
  const enterpriseCommands = [...proCommands, "batch", "api"];

  const allowedCommands: Record<string, string[]> = {
    free: freeCommands,
    basic: basicCommands,
    pro: proCommands,
    enterprise: enterpriseCommands,
  };

  return allowedCommands[tier]?.includes(command) ?? false;
}

/**
 * Login flow - prompt user for API key
 */
export async function login(apiKey: string): Promise<{ success: boolean; message: string }> {
  // Default Supabase configuration (polaristar project)
  const defaultConfig: SubscriptionConfig = {
    supabaseUrl: process.env.POLARISTAR_SUPABASE_URL || "https://mgrfrcltyusleljojzql.supabase.co",
    supabaseAnonKey: process.env.POLARISTAR_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ncmZyY2x0eXVzbGVsam9qenFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MTAxNTgsImV4cCI6MjA5MjM4NjE1OH0.esW8TVUKeWolt0qOUCbqGLb72zX1DW47ZcyRJ4SIExE",
    apiKey,
    machineId: getMachineId(),
  };

  // Validate API key format
  if (!apiKey || apiKey.length < 20) {
    return {
      success: false,
      message: "Invalid API key format. Key should be at least 20 characters.",
    };
  }

  // Try to verify with server
  const status = await checkSubscription(defaultConfig);

  if (status.active) {
    saveConfig(defaultConfig);
    return {
      success: true,
      message: `Logged in successfully!\nTier: ${status.tier}\nExpires: ${status.expiresAt || "N/A"}\nPages limit: ${status.pageLimit}`,
    };
  }

  // Save anyway for offline mode
  saveConfig(defaultConfig);

  return {
    success: false,
    message: status.error || "Verification failed, but config saved for offline use.",
  };
}

/**
 * Logout - clear config
 */
export function logout(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

/**
 * Get subscription status display
 */
export function formatStatus(status: SubscriptionStatus): string {
  const lines = [
    `Subscription: ${status.active ? "✓ Active" : "✗ Inactive"}`,
    `Tier: ${status.tier}`,
    `Pages: ${status.pagesUsed}/${status.pageLimit === -1 ? "∞" : status.pageLimit}`,
  ];

  if (status.expiresAt) {
    lines.push(`Expires: ${status.expiresAt}`);
  }

  if (status.daysRemaining !== undefined) {
    lines.push(`Days remaining: ${status.daysRemaining}`);
  }

  if (status.error) {
    lines.push(`Error: ${status.error}`);
  }

  return lines.join("\n");
}