# StockPilot by Bugdata — MVP starter

StockPilot is a retail inventory MVP with a web dashboard, Supabase/Postgres schema, authenticated REST API, and remote MCP server for compatible AI clients.

## What's included
- `web/index.html`: responsive interactive dashboard prototype with demo data and API connection notes.
- `server/src/api.ts`: authenticated Express API for products, dashboard summary, stock movements and sales.
- `server/src/mcp.ts`: MCP server exposing inventory tools over Streamable HTTP.
- `server/supabase/schema.sql`: tenant-aware schema, row-level security, stock ledger and starter categories.
- `.env.example`: configuration template.

## Important status
This is an MVP starter, not a deployed production service. The dashboard's built-in demo mode uses browser-local sample data. The StockPilot schema has been applied to the connected Supabase project `fpagqxumgaibapveyzuy` (`https://fpagqxumgaibapveyzuy.supabase.co`). The API and MCP server still require server environment variables, dependency installation, and deployment before they can access real records. Never put a Supabase service-role key in browser code.

## Architecture
Browser dashboard → authenticated Express API → Supabase/Postgres.
AI client (ChatGPT app/connector where supported, or Hermes) → MCP endpoint → same authenticated business services.

The MCP server resolves bearer tokens through the revocable `mcp_tokens` table and maps each token to a StockPilot user. Store only a SHA-256 hash, never the raw token. The legacy `MCP_BEARER_TOKEN`/`MCP_USER_ID` pair remains available for a controlled local pilot, but should not be used for a public multi-tenant rollout. OAuth or per-user credentials are required for production.

## 1. Create Supabase
1. Use the connected Supabase project or create a separate project for another environment.
2. The initial schema and RPC migration is already applied to the connected project. For a new project, run `server/supabase/schema.sql`.
3. Create a user in Supabase Auth.
4. Insert a row in `businesses` and a matching row in `business_members` for that Auth user's UUID (see SQL comments).
5. Copy the project URL and anon key into a local `server/.env` based on `.env.example`. Keep the service role key server-side only.

## 2. Configure and run API/MCP server
```bash
cd server
cp ../.env.example .env
npm install
npm run dev
Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PORT`, `MCP_BEARER_TOKEN`, and `MCP_USER_ID` in `.env`. `MCP_USER_ID` must be an existing Supabase Auth user UUID. Generate a strong token, e.g. `openssl rand -hex 32`.

The REST API listens on `http://localhost:9401`; MCP listens at `http://localhost:9401/mcp`.

## 3. Connect dashboard
Serve `web/` on a static host (GitHub Pages, Netlify, etc.). Copy `web/config.example.js` to `web/config.js` and set the deployed API URL plus the Supabase publishable/anon key. `config.js` is ignored by Git. The current page remains a demo UI and does not yet include the live Supabase sign-in form; do not use demo mode for real inventory.

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
- Use the atomic product-creation RPC so the product, opening-stock ledger, and audit entry cannot partially commit.
- Confirm local tax/accounting requirements with a qualified professional; gross profit here excludes overhead, tax and payment fees.

