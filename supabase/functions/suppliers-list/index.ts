import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

const CACHE_PREFIX = "suppliers:list:user:";
const CACHE_TTL_SECONDS = 60; // short cache for fast refresh
const LIST_FIELDS =
  "id,created_by,created_at,name,inn,is_smsp,company_number,company_mail,okved_main,okved_other,item,region,client,comment";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function parseJwtUserId(authHeader: string | null): string | null {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
      )
    );
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function redisGet(key: string): Promise<unknown[] | undefined> {
  const redisUrl = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const redisToken = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!redisUrl || !redisToken) return undefined;

  const response = await fetch(`${redisUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${redisToken}` }
  });
  if (!response.ok) return undefined;
  const payload = await response.json();
  if (!("result" in payload) || payload.result == null) return undefined;
  try {
    const parsed = JSON.parse(String(payload.result));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function redisSet(key: string, value: unknown[]) {
  const redisUrl = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const redisToken = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!redisUrl || !redisToken) return;

  const encodedValue = encodeURIComponent(JSON.stringify(value));
  await fetch(`${redisUrl}/set/${encodeURIComponent(key)}/${encodedValue}?EX=${CACHE_TTL_SECONDS}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken}` }
  }).catch(() => undefined);
}

async function loadSuppliersFromPostgrest(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const apikey = req.headers.get("apikey");
  if (!authHeader || !apikey) {
    return { data: null, error: "Missing Authorization or apikey" };
  }

  const origin = new URL(req.url).origin;
  const url = `${origin}/rest/v1/suppliers?select=${encodeURIComponent(LIST_FIELDS)}&order=created_at.desc`;
  const response = await fetch(url, {
    headers: {
      apikey,
      Authorization: authHeader
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return { data: null, error: payload?.message || `HTTP ${response.status}` };
  }

  return { data: Array.isArray(payload) ? payload : [], error: null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  const userId = parseJwtUserId(authHeader);
  if (!userId) return jsonResponse({ error: "Unauthorized" }, 401);

  const cacheKey = `${CACHE_PREFIX}${userId}`;
  const forceFresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (!forceFresh) {
    const cached = await redisGet(cacheKey);
    if (cached) return jsonResponse({ data: cached, source: "redis" });
  }

  const { data, error } = await loadSuppliersFromPostgrest(req);
  if (error || !data) return jsonResponse({ error: error || "Failed to load suppliers" }, 500);

  await redisSet(cacheKey, data);
  return jsonResponse({ data, source: "postgres" });
});

