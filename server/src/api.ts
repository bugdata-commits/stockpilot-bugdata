import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { admin, userFromToken, businessForUser, getProducts, lowStock, salesSummary, recordMovement, recordSale, HttpError } from './services.js';

export const api = express.Router();
api.use(express.json({ limit: '200kb' }));

type AuthRequest = Request & { user?: { id: string; email?: string }; business?: { businessId: string; role: string } };
async function requireUser(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Bearer access token required');
    const user = await userFromToken(token);
    req.user = { id: user.id, email: user.email };
    req.business = await businessForUser(user.id);
    next();
  } catch (e) { next(e); }
}
api.use(requireUser);
api.get('/me', (req: AuthRequest, res) => res.json({ user: req.user, business: req.business }));
api.get('/products', async (req: AuthRequest, res, next) => { try { res.json(await getProducts(req.business!.businessId, String(req.query.search ?? ''), Number(req.query.limit ?? 100))); } catch(e) { next(e); } });
api.post('/products', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ sku:z.string().trim().min(1).max(80), name:z.string().trim().min(1).max(160), category:z.string().trim().max(100).default('General'), unit:z.string().trim().max(30).default('unit'), currency:z.enum(['USD','ZWG']), costPrice:z.number().min(0), sellingPrice:z.number().min(0), quantity:z.number().min(0), reorderLevel:z.number().min(0).default(0) }).parse(req.body);
    const { data, error } = await admin.from('products').insert({ business_id:req.business!.businessId, sku:body.sku, name:body.name, category:body.category, unit:body.unit, currency:body.currency, cost_price:body.costPrice, selling_price:body.sellingPrice, quantity:body.quantity, reorder_level:body.reorderLevel }).select('*').single();
    if (error) throw new HttpError(400, error.message);
    if (body.quantity > 0) await admin.from('stock_movements').insert({ business_id:req.business!.businessId, product_id:data.id, movement_type:'opening', quantity_delta:body.quantity, quantity_after:body.quantity, currency:body.currency, unit_cost:body.costPrice, reason:'Opening stock on product creation', created_by:req.user!.id });
    await admin.from('audit_log').insert({ business_id:req.business!.businessId, actor_user_id:req.user!.id, action:'product_created', entity_type:'product', entity_id:data.id, details:{sku:body.sku,name:body.name} });
    res.status(201).json(data);
  } catch(e) { next(e); }
});
api.patch('/products/:id', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({ name:z.string().trim().min(1).max(160).optional(), category:z.string().trim().max(100).optional(), costPrice:z.number().min(0).optional(), sellingPrice:z.number().min(0).optional(), reorderLevel:z.number().min(0).optional(), active:z.boolean().optional() }).strict().parse(req.body);
    const update:Record<string,unknown> = { updated_at:new Date().toISOString() };
    if(body.name!==undefined) update.name=body.name; if(body.category!==undefined) update.category=body.category; if(body.costPrice!==undefined) update.cost_price=body.costPrice; if(body.sellingPrice!==undefined) update.selling_price=body.sellingPrice; if(body.reorderLevel!==undefined) update.reorder_level=body.reorderLevel; if(body.active!==undefined) update.active=body.active;
    const {data,error}=await admin.from('products').update(update).eq('id',req.params.id).eq('business_id',req.business!.businessId).select('*').single();
    if(error||!data) throw new HttpError(404,error?.message ?? 'Product not found');
    await admin.from('audit_log').insert({business_id:req.business!.businessId,actor_user_id:req.user!.id,action:'product_updated',entity_type:'product',entity_id:data.id,details:update}); res.json(data);
  } catch(e) { next(e); }
});
api.get('/low-stock', async (req: AuthRequest, res, next) => { try { res.json(await lowStock(req.business!.businessId)); } catch(e) { next(e); } });
api.get('/dashboard', async (req: AuthRequest, res, next) => {
  try {
    const businessId=req.business!.businessId;
    const [products,alerts,usd,zwg]=await Promise.all([getProducts(businessId,'',250),lowStock(businessId),salesSummary(businessId,'USD',new Date(Date.now()-30*86400000).toISOString(),new Date().toISOString()),salesSummary(businessId,'ZWG',new Date(Date.now()-30*86400000).toISOString(),new Date().toISOString())]);
    const value:Record<string,{cost:number;retail:number}>={USD:{cost:0,retail:0},ZWG:{cost:0,retail:0}};
    for(const p of products){value[p.currency].cost+=Number(p.quantity)*Number(p.cost_price);value[p.currency].retail+=Number(p.quantity)*Number(p.selling_price);}
    res.json({productCount:products.length,lowStockCount:alerts.length,stockValue:value,salesLast30Days:{USD:usd,ZWG:zwg},lowStock:alerts.slice(0,10)});
  } catch(e) { next(e); }
});
api.post('/stock-movements', async (req: AuthRequest, res, next) => {
  try { const body=z.object({productId:z.string().uuid(),quantityDelta:z.number().refine(n=>n!==0),movementType:z.enum(['opening','purchase','adjustment','return']),reason:z.string().trim().min(3).max(300),currency:z.enum(['USD','ZWG']).optional(),unitCost:z.number().min(0).optional()}).parse(req.body); res.status(201).json(await recordMovement({userId:req.user!.id,businessId:req.business!.businessId,...body})); } catch(e) { next(e); }
});
api.post('/sales', async (req: AuthRequest, res, next) => {
  try { const body=z.object({currency:z.enum(['USD','ZWG']),items:z.array(z.object({productId:z.string().uuid(),quantity:z.number().positive(),unitPrice:z.number().min(0).optional()})).min(1).max(100),reference:z.string().max(100).optional(),notes:z.string().max(1000).optional()}).parse(req.body); res.status(201).json(await recordSale({userId:req.user!.id,businessId:req.business!.businessId,...body})); } catch(e) { next(e); }
});
api.get('/sales-summary', async (req: AuthRequest, res, next) => {
  try { const currency=z.enum(['USD','ZWG']).parse(req.query.currency ?? 'USD'); const from=z.string().datetime().parse(req.query.from ?? new Date(Date.now()-30*86400000).toISOString()); const to=z.string().datetime().parse(req.query.to ?? new Date().toISOString()); res.json(await salesSummary(req.business!.businessId,currency,from,to)); } catch(e) { next(e); }
});
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof z.ZodError) return res.status(400).json({error:'Invalid request',details:err.issues});
  const status = err instanceof HttpError ? err.status : 500;
  if(status===500) console.error(err);
  return res.status(status).json({error:status===500?'Internal server error':err.message});
}



