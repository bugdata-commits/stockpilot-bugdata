import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { api, errorHandler } from './api.js';
import { handleMcp } from './mcp.js';

const app=express();
const origins=(process.env.CORS_ORIGINS??'http://localhost:5173').split(',').map(s=>s.trim()).filter(Boolean);
app.use(cors({origin(origin,callback){ if(!origin || origins.includes(origin)) return callback(null,true); return callback(new Error('Origin not allowed by CORS')); }, methods:['GET','POST','PATCH','OPTIONS'], allowedHeaders:['Content-Type','Authorization','Mcp-Session-Id','Mcp-Protocol-Version']}));
app.get('/health',(_req,res)=>res.json({ok:true,service:'stockpilot-bugdata',time:new Date().toISOString()}));
app.use('/api',api);
app.all('/mcp',express.json({limit:'200kb'}),handleMcp);
app.use(errorHandler);
const port=Number(process.env.PORT??9401);
app.listen(port,()=>console.log(`StockPilot API + MCP listening on :${port}`));



