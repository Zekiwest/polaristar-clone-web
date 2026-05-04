// Supabase Edge Function: report-usage
// Records usage and updates counters

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

serve(async (req) => {
  try {
    // Only allow POST requests
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get headers
    const apiKeyHeader = req.headers.get("X-Api-Key");
    const machineId = req.headers.get("X-Machine-Id") || "unknown";

    if (!apiKeyHeader) {
      return new Response(JSON.stringify({ error: "Missing API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse body
    const body = await req.json();
    const pages = body.pages || 1;
    const command = body.command || "unknown";
    const metadata = body.metadata || {};

    // Hash the API key
    const keyHash = await hashKey(apiKeyHeader);

    // Verify the API key
    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select("id, user_id")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (keyError || !keyData) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get subscription to check limits
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("tier, current_period_end")
      .eq("user_id", keyData.user_id)
      .eq("status", "active")
      .order("current_period_end", { ascending: false })
      .limit(1)
      .single();

    if (!subscription) {
      return new Response(JSON.stringify({ error: "No active subscription" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get tier limits
    const { data: tierLimit } = await supabase
      .from("tier_limits")
      .select("page_limit")
      .eq("tier", subscription.tier)
      .single();

    // Get current month usage
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: usageData } = await supabase
      .from("usage_logs")
      .select("pages")
      .eq("user_id", keyData.user_id)
      .gte("timestamp", startOfMonth.toISOString());

    const currentUsage = usageData?.reduce((sum, log) => sum + log.pages, 0) || 0;

    // Check if within limits (unless enterprise/unlimited)
    if (tierLimit?.page_limit !== -1 && currentUsage + pages > tierLimit?.page_limit) {
      return new Response(
        JSON.stringify({
          error: "Monthly page limit exceeded",
          currentUsage,
          limit: tierLimit?.page_limit,
          remaining: 0,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Record usage
    const { error: insertError } = await supabase.from("usage_logs").insert({
      user_id: keyData.user_id,
      api_key_id: keyData.id,
      machine_id: machineId,
      command,
      pages,
      timestamp: new Date().toISOString(),
      metadata,
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to record usage" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        pagesRecorded: pages,
        currentUsage: currentUsage + pages,
        limit: tierLimit?.page_limit,
        remaining: tierLimit?.page_limit === -1 ? -1 : tierLimit?.page_limit - (currentUsage + pages),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// Helper function to hash API key
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}