// Supabase Edge Function: verify-subscription
// Verifies API key and returns subscription status

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
    const machineId = req.headers.get("X-Machine-Id");

    if (!apiKeyHeader) {
      return new Response(JSON.stringify({ error: "Missing API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Hash the API key
    const keyHash = await hashKey(apiKeyHeader);

    // Verify the API key and get subscription info
    const { data: keyData, error: keyError } = await supabase
      .from("api_keys")
      .select(`
        id,
        user_id,
        key_hash,
        is_active,
        machine_ids,
        max_machines
      `)
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (keyError || !keyData) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check machine binding
    if (machineId && keyData.machine_ids.length > 0) {
      if (!keyData.machine_ids.includes(machineId)) {
        if (keyData.machine_ids.length >= keyData.max_machines) {
          return new Response(
            JSON.stringify({ error: "Device limit reached. Please contact support." }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }
        // Add new machine ID
        const newMachineIds = [...keyData.machine_ids, machineId];
        await supabase
          .from("api_keys")
          .update({ machine_ids: newMachineIds, last_used_at: new Date().toISOString() })
          .eq("id", keyData.id);
      }
    } else if (machineId && keyData.machine_ids.length === 0) {
      // Bind first machine
      await supabase
        .from("api_keys")
        .update({ machine_ids: [machineId], last_used_at: new Date().toISOString() })
        .eq("id", keyData.id);
    }

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select(`
        tier,
        status,
        current_period_end
      `)
      .eq("user_id", keyData.user_id)
      .eq("status", "active")
      .order("current_period_end", { ascending: false })
      .limit(1)
      .single();

    if (subError || !subscription) {
      return new Response(JSON.stringify({ error: "No active subscription" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if expired
    if (subscription.current_period_end && new Date(subscription.current_period_end) < new Date()) {
      return new Response(JSON.stringify({ error: "Subscription expired" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get tier limits
    const { data: tierLimit } = await supabase
      .from("tier_limits")
      .select("page_limit, features")
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

    const pagesUsed = usageData?.reduce((sum, log) => sum + log.pages, 0) || 0;

    // Calculate days remaining
    const daysRemaining = subscription.current_period_end
      ? Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    // Update last_used_at
    await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyData.id);

    return new Response(
      JSON.stringify({
        active: true,
        tier: subscription.tier,
        expiresAt: subscription.current_period_end,
        pageLimit: tierLimit?.page_limit || 0,
        pagesUsed,
        daysRemaining,
        features: tierLimit?.features || {},
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
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