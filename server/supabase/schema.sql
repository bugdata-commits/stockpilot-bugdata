-- StockPilot by Bugdata: PostgreSQL/Supabase schema
create extension if not exists pgcrypto;

create type public.stockpilot_currency as enum ('USD', 'ZWG');
create type public.stockpilot_movement_type as enum ('opening', 'purchase', 'sale', 'adjustment', 'return');

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency public.stockpilot_currency not null default 'USD',
  created_at timestamptz not null default now()
);
create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null default 'General',
  unit text not null default 'unit',
  currency public.stockpilot_currency not null default 'USD',
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku)
);
create index if not exists products_business_name_idx on public.products(business_id, name);
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  currency public.stockpilot_currency not null,
  total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null check (cost_total >= 0),
  reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists sales_business_created_idx on public.sales(business_id, created_at desc);
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name_snapshot text not null,
  sku_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  line_cost numeric(14,2) not null check (line_cost >= 0)
);
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id),
  movement_type public.stockpilot_movement_type not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  quantity_after numeric(14,3) not null check (quantity_after >= 0),
  currency public.stockpilot_currency,
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  reference_id uuid,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_business_created_idx on public.stock_movements(business_id, created_at desc);
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Pilot MCP tokens are stored as hashes, never plaintext. Provision through trusted server-side admin tooling.
create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_sha256 text not null unique,
  label text not null default 'MCP client',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS is enabled for browser-side access. This MVP routes writes through a server that performs
-- explicit business-membership checks. Add equivalent policies before enabling direct browser queries.
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_log enable row level security;
alter table public.mcp_tokens enable row level security;

create policy "members read own businesses" on public.businesses for select to authenticated
using (exists (select 1 from public.business_members bm where bm.business_id = id and bm.user_id = auth.uid()));
create policy "members read membership rows" on public.business_members for select to authenticated using (user_id = auth.uid());
create policy "members read own products" on public.products for select to authenticated
using (exists (select 1 from public.business_members bm where bm.business_id = products.business_id and bm.user_id = auth.uid()));
create policy "members read own sales" on public.sales for select to authenticated
using (exists (select 1 from public.business_members bm where bm.business_id = sales.business_id and bm.user_id = auth.uid()));
create policy "members read sale items" on public.sale_items for select to authenticated
using (exists (select 1 from public.sales s join public.business_members bm on bm.business_id=s.business_id where s.id=sale_id and bm.user_id=auth.uid()));
create policy "members read stock movements" on public.stock_movements for select to authenticated
using (exists (select 1 from public.business_members bm where bm.business_id = stock_movements.business_id and bm.user_id = auth.uid()));
create policy "members read audit log" on public.audit_log for select to authenticated
using (exists (select 1 from public.business_members bm where bm.business_id = audit_log.business_id and bm.user_id = auth.uid()));
-- Do not grant end users access to MCP token hashes.

-- Provisioning example (replace values after creating a Supabase Auth user):
-- insert into public.businesses(name, base_currency) values ('Demo Retail Shop','USD') returning id;
-- insert into public.business_members(business_id,user_id,role) values ('<business-uuid>','<auth-user-uuid>','owner');
-- The service-role key bypasses RLS and MUST stay on the server only.

-- Atomic sale recording: locks product rows before checking and deducting stock.
create or replace function public.stockpilot_record_sale(
  p_business_id uuid, p_user_id uuid, p_currency public.stockpilot_currency,
  p_items jsonb, p_reference text default null, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  item jsonb; product_row public.products%rowtype; v_qty numeric(14,3); v_price numeric(14,2);
  v_line_total numeric(14,2); v_line_cost numeric(14,2); v_total numeric(14,2):=0; v_cost_total numeric(14,2):=0;
  v_sale public.sales%rowtype; v_items jsonb:='[]'::jsonb; v_after numeric(14,3);
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Provide between 1 and 100 sale items';
  end if;
  -- Validate and lock all products in deterministic ID order to reduce deadlocks.
  for item in select value from jsonb_array_elements(p_items) order by (value->>'productId') loop
    v_qty := (item->>'quantity')::numeric;
    if v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into product_row from public.products where id=(item->>'productId')::uuid and business_id=p_business_id and active=true for update;
    if not found then raise exception 'Product not found in this business'; end if;
    if product_row.currency <> p_currency then raise exception 'Currency mismatch for product %', product_row.name; end if;
    if product_row.quantity < v_qty then raise exception 'Insufficient stock for %', product_row.name; end if;
    v_price := coalesce((item->>'unitPrice')::numeric, product_row.selling_price);
    if v_price < 0 then raise exception 'Unit price cannot be negative'; end if;
    v_total := v_total + round(v_price*v_qty,2);
    v_cost_total := v_cost_total + round(product_row.cost_price*v_qty,2);
  end loop;
  insert into public.sales(business_id,currency,total,cost_total,reference,notes,created_by)
    values(p_business_id,p_currency,round(v_total,2),round(v_cost_total,2),p_reference,p_notes,p_user_id) returning * into v_sale;
  for item in select value from jsonb_array_elements(p_items) loop
    v_qty := (item->>'quantity')::numeric;
    select * into product_row from public.products where id=(item->>'productId')::uuid and business_id=p_business_id for update;
    v_price := coalesce((item->>'unitPrice')::numeric,product_row.selling_price);
    v_line_total := round(v_price*v_qty,2); v_line_cost := round(product_row.cost_price*v_qty,2);
    v_after := product_row.quantity-v_qty;
    update public.products set quantity=v_after,updated_at=now() where id=product_row.id;
    insert into public.sale_items(sale_id,product_id,product_name_snapshot,sku_snapshot,quantity,unit_price,unit_cost,line_total,line_cost)
      values(v_sale.id,product_row.id,product_row.name,product_row.sku,v_qty,v_price,product_row.cost_price,v_line_total,v_line_cost);
    insert into public.stock_movements(business_id,product_id,movement_type,quantity_delta,quantity_after,currency,unit_cost,reference_id,reason,created_by)
      values(p_business_id,product_row.id,'sale',-v_qty,v_after,p_currency,product_row.cost_price,v_sale.id,'Sale '||v_sale.id,p_user_id);
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId',product_row.id,'name',product_row.name,'quantity',v_qty,'unitPrice',v_price,'lineTotal',v_line_total));
  end loop;
  insert into public.audit_log(business_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_business_id,p_user_id,'sale_recorded','sale',v_sale.id,jsonb_build_object('total',v_total,'currency',p_currency,'itemCount',jsonb_array_length(p_items)));
  return jsonb_build_object('id',v_sale.id,'business_id',v_sale.business_id,'currency',v_sale.currency,'total',v_sale.total,'cost_total',v_sale.cost_total,'reference',v_sale.reference,'created_at',v_sale.created_at,'items',v_items,'grossProfit',round(v_total-v_cost_total,2));
end; $$;

-- Atomic stock movement: lock product, validate resulting quantity, then write ledger and audit.
create or replace function public.stockpilot_record_stock_movement(
  p_business_id uuid, p_user_id uuid, p_product_id uuid, p_quantity_delta numeric,
  p_movement_type public.stockpilot_movement_type, p_reason text,
  p_currency public.stockpilot_currency default null, p_unit_cost numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.products%rowtype; v_after numeric(14,3); v_movement public.stock_movements%rowtype;
begin
  if p_quantity_delta=0 or p_reason is null or length(trim(p_reason))<3 then raise exception 'Non-zero quantity and reason are required'; end if;
  select * into p from public.products where id=p_product_id and business_id=p_business_id for update;
  if not found then raise exception 'Product not found in this business'; end if;
  v_after := p.quantity+p_quantity_delta;
  if v_after<0 then raise exception 'Stock cannot become negative'; end if;
  update public.products set quantity=v_after,updated_at=now() where id=p.id;
  insert into public.stock_movements(business_id,product_id,movement_type,quantity_delta,quantity_after,currency,unit_cost,reason,created_by)
    values(p_business_id,p.id,p_movement_type,p_quantity_delta,v_after,coalesce(p_currency,p.currency),coalesce(p_unit_cost,p.cost_price),trim(p_reason),p_user_id) returning * into v_movement;
  insert into public.audit_log(business_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_business_id,p_user_id,'stock_movement_recorded','product',p.id,jsonb_build_object('quantityDelta',p_quantity_delta,'quantityAfter',v_after,'reason',p_reason));
  return jsonb_build_object('product',jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku,'quantity',v_after),'movement',to_jsonb(v_movement));
end; $$;

revoke all on function public.stockpilot_record_sale(uuid,uuid,public.stockpilot_currency,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.stockpilot_record_stock_movement(uuid,uuid,uuid,numeric,public.stockpilot_movement_type,text,public.stockpilot_currency,numeric) from public, anon, authenticated;
grant execute on function public.stockpilot_record_sale(uuid,uuid,public.stockpilot_currency,jsonb,text,text) to service_role;
grant execute on function public.stockpilot_record_stock_movement(uuid,uuid,uuid,numeric,public.stockpilot_movement_type,text,public.stockpilot_currency,numeric) to service_role;

