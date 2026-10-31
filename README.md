# StockPilot by Bugdata — MVP starter

StockPilot is a retail inventory MVP with a web dashboard, Supabase/Postgres schema, authenticated REST API, and remote MCP server for compatible AI clients.

## What's included
- `web/index.html`: responsive interactive dashboard prototype with demo data and API connection notes.
- `server/src/api.ts`: authenticated Express API for products, dashboard summary, stock movements and sales.
- `server/src/mcp.ts`: MCP server exposing inventory tools over Streamable HTTP.
- `server/supabase/schema.sql`: tenant-aware schema, row-level security, stock ledger and starter categories.
- `.env.example`: configuration template.

## Important status
This is an MVP starter, not a deployed production service. The dashboard's built-in demo mode uses browser-local sample data. The API and MCP server require a configured Supabase project, environment variables, dependency installation, and deployment before they can access real records. Never put a Supabase service-role key in browser code.

## Architecture
Browser dashboard → authenticated Express API → Supabase/Postgres.
AI client (ChatGPT app/connector where supported, or Hermes) → MCP endpoint → same authenticated business services.

The MCP server uses a bearer token mapped to a StockPilot user. For initial pilots, create a dedicated `STOCKPILOT_MCP_TOKEN` per user and store its SHA-256 hash in `mcp_tokens`; never use one shared token across customers. A production rollout should use OAuth where required by the target client and rotate/revoke credentials.

## 1. Create Supabase
1. Create a Supabase project.
2. Open SQL Editor and run `server/supabase/schema.sql`.
3. Create a user in Supabase Auth.
4. Insert a row in `profiles` mapping that Auth user's UUID to a business in `business_members` (see SQL comments).
5. Copy project URL and anon key. Keep service role key server-side only.

## 2. Configure and run API/MCP server
```bash
cd server
cp ../.env.example .env
npm install
npm run dev
Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`, `MCP_BEARER_TOKEN`, and `MCP_USER_ID` in `.env`. `MCP_USER_ID` must be an existing Supabase Auth user UUID. Generate a strong token, e.g. `openssl rand -hex 32`.

The REST API listens on `http://localhost:9401`; MCP listens at `http://localhost:9401/mcp`.

## 3. Connect dashboard
Serve `web/` on a static host (GitHub Pages, Netlify, etc.). Set `window.STOCKPILOT_API_BASE` before `app.js` loads, or edit the constant in `web/app.js` to your deployed API URL. Sign in with Supabase Auth in the production UI; the current static page is a design prototype and does not yet include the sign-in form. Do not use demo mode for real inventory.

## 4. MCP tools
- `stockpilot_list_products`: list products and quantities.
- `stockpilot_low_stock`: list products at/below reorder level.
- `stockpilot_sales_summary`: summarize sales over a date range, in one currency at a time.
- `stockpilot_record_stock_movement`: record a stock adjustment/receipt with a reason.
- `stockpilot_record_sale`: record a sale and deduct inventory atomically.

The MCP token maps to one user and all queries are scoped to that user's business membership. Mutating tools validate arguments and write audit/ledger records. Keep tools read-only until the pilot has been tested; require confirmation in the AI client for writes.

## 5. Deployment
- Deploy `server/` to a Node-capable host or VPS with HTTPS.
- Set all `.env` values in the host's secret manager, not in source control.
- Restrict CORS to the real dashboard origin.
- Use a persistent database (Supabase) and enable backups.
- Expose `/health` for health checks and `/mcp` over HTTPS.
- In ChatGPT, use the supported custom app/connector route available to your account and provide the remote MCP URL plus the required authentication. Availability and authentication requirements vary by ChatGPT plan/workspace and may require OAuth; a bearer-token MCP URL alone does not guarantee it can be added to every ChatGPT surface.
- For Hermes, configure its MCP/client integration with the remote URL and token according to the installed Hermes version.

## Security checklist before real customers
- Implement full Supabase Auth sign-in in the web UI and send the user's access token to the API.
- Replace the starter single-token MCP auth with OAuth or per-user credentials for public multi-tenant deployment.
- Set CORS to a specific origin.
- Add rate limiting, request size limits, structured logging and monitoring.
- Test tenant isolation and concurrent sale/stock updates.
- Confirm local tax/accounting requirements with a qualified professional; gross profit here excludes overhead, tax and payment fees.



