// Supabase Edge Function: create-api-key
// Creates a new API key for authenticated user

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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get auth header
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create client with user's token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user info
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse body
    const body = await req.json();
    const keyName = body.name || "Default Key";

    // Generate API key
    const apiKey = generateApiKey();

    // Hash the API key for storage
    const keyHash = await hashKey(apiKey);
    const keyPrefix = apiKey.slice(0, 8);

    // Use service client to insert
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Insert API key
    const { error: insertError } = await serviceClient.from("api_keys").insert({
      user_id: user.id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name: keyName,
      is_active: true,
      machine_ids: [],
      max_machines: 3,
    });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create API key" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        apiKey, // Return full key only once!
        keyPrefix,
        name: keyName,
        message: "Store this key securely. It will not be shown again.",
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

// Generate random API key
function generateApiKey(): string {
  const prefix = "pk_"; // Polaristar key prefix
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const randomString = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return prefix + randomString;
}

// Helper function to hash API key
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}