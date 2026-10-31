import { createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { businessForUser, getProducts, lowStock, salesSummary, recordMovement, recordSale, HttpError } from './services.js';
import type { Request, Response } from 'express';

const expected = process.env.MCP_BEARER_TOKEN ?? '';
const mcpUserId = process.env.MCP_USER_ID ?? '';
function safeEqual(a:string,b:string) { const aa=Buffer.from(a); const bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb); }
function serverFor(userId:string) {
  const server = new McpServer({ name:'stockpilot-bugdata', version:'0.1.0' });
  server.tool('stockpilot_list_products','List active inventory products for the authenticated business.',{search:z.string().optional(),limit:z.number().int().min(1).max(100).optional()},async({search,limit})=>{
    const {businessId}=await businessForUser(userId); const rows=await getProducts(businessId,search??'',limit??50);
    return {content:[{type:'text',text:JSON.stringify(rows.map(p=>({id:p.id,sku:p.sku,name:p.name,category:p.category,quantity:p.quantity,unit:p.unit,currency:p.currency,costPrice:p.cost_price,sellingPrice:p.selling_price,reorderLevel:p.reorder_level})),null,2)}]};
  });
  server.tool('stockpilot_low_stock','List products whose quantity is at or below their reorder threshold.',{},async()=>{
    const {businessId}=await businessForUser(userId); const rows=await lowStock(businessId);
    return {content:[{type:'text',text:JSON.stringify(rows,null,2)}]};
  });
  server.tool('stockpilot_sales_summary','Summarize sales and estimated gross profit for one currency over an ISO date range. USD and ZWG are never combined.',{currency:z.enum(['USD','ZWG']),from:z.string().datetime(),to:z.string().datetime()},async({currency,from,to})=>{
    const {businessId}=await businessForUser(userId); const result=await salesSummary(businessId,currency,from,to);
    return {content:[{type:'text',text:JSON.stringify(result,null,2)}]};
  });
  server.tool('stockpilot_record_stock_movement','Record stock received or an adjustment. Require explicit user authorization before calling.',{productId:z.string().uuid(),quantityDelta:z.number().refine(n=>n!==0),movementType:z.enum(['opening','purchase','adjustment','return']),reason:z.string().min(3).max(300),currency:z.enum(['USD','ZWG']).optional(),unitCost:z.number().min(0).optional()},async(args)=>{
    const {businessId,role}=await businessForUser(userId); if(!['owner','manager'].includes(role)) throw new HttpError(403,'Only owners/managers can change stock');
    const result=await recordMovement({userId,businessId,...args}); return {content:[{type:'text',text:JSON.stringify(result,null,2)}]};
  });
  server.tool('stockpilot_record_sale','Record a sale and deduct inventory. Confirm the sale details with the user before calling.',{currency:z.enum(['USD','ZWG']),items:z.array(z.object({productId:z.string().uuid(),quantity:z.number().positive(),unitPrice:z.number().min(0).optional()})).min(1).max(50),reference:z.string().max(100).optional(),notes:z.string().max(1000).optional()},async(args)=>{
    const {businessId,role}=await businessForUser(userId); if(!['owner','manager','staff'].includes(role)) throw new HttpError(403,'This role cannot record sales');
    const result=await recordSale({userId,businessId,...args}); return {content:[{type:'text',text:JSON.stringify(result,null,2)}]};
  });
  return server;
}
export async function handleMcp(req:Request,res:Response) {
  const authorization=req.headers.authorization??'';
  const token=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!expected || !mcpUserId || !safeEqual(token,expected)) return res.status(401).json({error:'Unauthorized MCP client'});
  try {
    // Stateless per-request transport keeps the pilot simple. Configure OAuth/session handling for public rollout.
    const server=serverFor(mcpUserId);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  } catch(e:any) { if(!res.headersSent) res.status(e instanceof HttpError?e.status:500).json({error:e.message??'MCP request failed'}); }
}



