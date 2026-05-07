# Redis setup for DaData cache

This project now includes a versioned Supabase Edge Function source at:

- `supabase/functions/dadata-by-inn/index.ts`
- `supabase/functions/suppliers-list/index.ts`

It adds Redis cache (Upstash REST API) for INN lookups.

## 1) Create Upstash Redis

1. Create a database in Upstash.
2. Copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

## 2) Set Supabase secrets

Add secrets in Supabase for the project:

- `DADATA_API_KEY` (required)
- `DADATA_SECRET` (optional)
- `UPSTASH_REDIS_REST_URL` (optional, but required for cache)
- `UPSTASH_REDIS_REST_TOKEN` (optional, but required for cache)

If Redis secrets are missing, function still works and falls back to direct DaData requests.

## 3) Deploy function source

If you use Supabase CLI:

```bash
supabase functions deploy dadata-by-inn
supabase functions deploy suppliers-list
```

Or copy `index.ts` content into Supabase dashboard function editor and deploy.

## 4) Behavior

- Cache key: `dadata:inn:<INN>`
- Cache TTL:
  - success response: 7 days
  - not found response: 6 hours
- Response includes `source`:
  - `redis` when served from cache
  - `dadata` when fetched from DaData

## 5) Suppliers list cache

`suppliers-list` function caches table rows per authenticated user:

- Cache key: `suppliers:list:user:<userId>`
- TTL: 60 seconds
- Query params:
  - default: serve cache if exists
  - `?fresh=1`: bypass cache, reload from Postgres, and refresh Redis cache

