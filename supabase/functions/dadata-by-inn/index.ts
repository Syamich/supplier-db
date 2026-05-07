import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type DadataResult = {
  name: string;
  okved_main: string;
  okved_other: string[];
  region: string[];
  company_number: string[];
  company_mail: string[];
};

const CACHE_PREFIX = "dadata:inn:";
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const NOT_FOUND_TTL_SECONDS = 60 * 60 * 6; // 6 hours

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

async function redisGet(key: string): Promise<DadataResult | null | undefined> {
  const redisUrl = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const redisToken = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!redisUrl || !redisToken) return undefined;

  const url = `${redisUrl}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${redisToken}` }
  });

  if (!response.ok) return undefined;
  const payload = await response.json();
  if (!("result" in payload)) return undefined;
  if (payload.result === null) return null;

  try {
    return JSON.parse(String(payload.result));
  } catch {
    return undefined;
  }
}

async function redisSet(key: string, value: DadataResult | null, ttlSeconds: number) {
  const redisUrl = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const redisToken = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!redisUrl || !redisToken) return;

  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const url = `${redisUrl}/set/${encodeURIComponent(key)}/${encodedValue}?EX=${ttlSeconds}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken}` }
  }).catch(() => undefined);
}

function mapDadataItem(item: any): DadataResult {
  const phones = Array.isArray(item?.phones)
    ? item.phones.map((p: any) => p?.value).filter(Boolean)
    : [];
  const emails = Array.isArray(item?.emails)
    ? item.emails.map((e: any) => e?.value).filter(Boolean)
    : [];

  return {
    name: item?.name?.short_with_opf || item?.name?.full_with_opf || "",
    okved_main: item?.okved || "",
    okved_other: [],
    region: item?.address?.data?.region_with_type ? [item.address.data.region_with_type] : [],
    company_number: phones,
    company_mail: emails
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const inn = String(body?.inn || "").replace(/\D/g, "");
    if (!/^\d{10}(\d{2})?$/.test(inn)) {
      return jsonResponse({ error: "Некорректный ИНН" }, 400);
    }

    const cacheKey = `${CACHE_PREFIX}${inn}`;
    const cached = await redisGet(cacheKey);
    if (cached !== undefined) {
      return jsonResponse({ data: cached, source: "redis" });
    }

    const apiKey = Deno.env.get("DADATA_API_KEY");
    const secret = Deno.env.get("DADATA_SECRET");
    if (!apiKey) {
      return jsonResponse({ error: "DADATA_API_KEY не задан" }, 500);
    }

    const dadataResp = await fetch(
      "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Token ${apiKey}`,
          ...(secret ? { "X-Secret": secret } : {})
        },
        body: JSON.stringify({ query: inn, count: 1 })
      }
    );

    const raw = await dadataResp.json();
    const item = raw?.suggestions?.[0]?.data;
    if (!item) {
      await redisSet(cacheKey, null, NOT_FOUND_TTL_SECONDS);
      return jsonResponse({ data: null, source: "dadata" });
    }

    const mapped = mapDadataItem(item);
    await redisSet(cacheKey, mapped, CACHE_TTL_SECONDS);
    return jsonResponse({ data: mapped, source: "dadata" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка функции";
    return jsonResponse({ error: message }, 500);
  }
});

