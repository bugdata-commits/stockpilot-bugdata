import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = process.env.SUPABASE_URL!;
export const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
export const admin: SupabaseClient = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const authClient: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function userFromToken(token: string) {
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired access token');
  return data.user;
}
export async function businessForUser(userId: string) {
  const { data, error } = await admin.from('business_members').select('business_id, role').eq('user_id', userId).limit(2);
  if (error) throw new HttpError(500, 'Could not load business membership');
  if (!data?.length) throw new HttpError(403, 'This user is not a member of a StockPilot business');
  if (data.length > 1) throw new HttpError(400, 'This MVP user belongs to multiple businesses; select a business context first');
  return { businessId: data[0].business_id as string, role: data[0].role as string };
}
export async function getProducts(businessId: string, search = '', limit = 100) {
  let q = admin.from('products').select('*').eq('business_id', businessId).eq('active', true).order('name').limit(Math.min(Math.max(limit, 1), 250));
  if (search.trim()) q = q.or(`name.ilike.%${search.trim().replace(/[%_]/g, '')}%,sku.ilike.%${search.trim().replace(/[%_]/g, '')}%`);
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return data ?? [];
}
export async function lowStock(businessId: string) {
  const { data, error } = await admin.from('products').select('id,sku,name,category,quantity,reorder_level,unit,currency').eq('business_id', businessId).eq('active', true).order('name');
  if (error) throw new HttpError(500, error.message);
  return (data ?? []).filter(p => Number(p.quantity) <= Number(p.reorder_level));
}
export async function salesSummary(businessId: string, currency: 'USD'|'ZWG', from: string, to: string) {
  const { data, error } = await admin.from('sales').select('id,total,cost_total,created_at').eq('business_id', businessId).eq('currency', currency).gte('created_at', from).lte('created_at', to).order('created_at', { ascending: false });
  if (error) throw new HttpError(500, error.message);
  const rows = data ?? [];
  return { currency, from, to, saleCount: rows.length, revenue: rows.reduce((n, r) => n + Number(r.total), 0), cost: rows.reduce((n, r) => n + Number(r.cost_total), 0), grossProfit: rows.reduce((n, r) => n + Number(r.total) - Number(r.cost_total), 0), sales: rows };
}
export async function recordMovement(args: {userId:string; businessId:string; productId:string; quantityDelta:number; movementType:'opening'|'purchase'|'adjustment'|'return'; reason:string; currency?:'USD'|'ZWG'; unitCost?:number}) {
  if (!Number.isFinite(args.quantityDelta) || args.quantityDelta === 0) throw new HttpError(400, 'quantityDelta must be a non-zero number');
  if (!args.reason?.trim()) throw new HttpError(400, 'A reason is required');
  const { data, error } = await admin.rpc('stockpilot_record_stock_movement', {
    p_business_id: args.businessId, p_user_id: args.userId, p_product_id: args.productId,
    p_quantity_delta: args.quantityDelta, p_movement_type: args.movementType,
    p_reason: args.reason, p_currency: args.currency ?? null, p_unit_cost: args.unitCost ?? null
  });
  if (error) throw new HttpError(error.message.includes('not found') ? 404 : error.message.includes('negative') ? 409 : 400, error.message);
  return data;
}
export async function recordSale(args: {userId:string; businessId:string; currency:'USD'|'ZWG'; items:Array<{productId:string;quantity:number;unitPrice?:number}>; reference?:string; notes?:string}) {
  if (!args.items.length || args.items.length > 100) throw new HttpError(400, 'Provide between 1 and 100 sale items');
  const seen = new Set<string>();
  for (const item of args.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new HttpError(400, 'Each quantity must be positive');
    if (seen.has(item.productId)) throw new HttpError(400, 'Use one line per product in a sale');
    seen.add(item.productId);
  }
  const { data, error } = await admin.rpc('stockpilot_record_sale', {
    p_business_id: args.businessId, p_user_id: args.userId, p_currency: args.currency,
    p_items: args.items.map(i => ({ productId:i.productId, quantity:i.quantity, ...(i.unitPrice===undefined?{}:{unitPrice:i.unitPrice}) })),
    p_reference: args.reference ?? null, p_notes: args.notes ?? null
  });
  if (error) {
    const msg=error.message ?? 'Sale could not be recorded';
    const status=msg.includes('not found')?404:(msg.includes('Insufficient stock')||msg.includes('negative'))?409:400;
    throw new HttpError(status,msg);
  }
  return data;
}



