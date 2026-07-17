import express from "express";
import { chromium } from "playwright";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 10000;
app.use(express.json({ limit: "1mb" }));
app.use(express.static("."));

const jobs = new Map();
let cache = { at: 0, results: [] };
const CACHE_TTL = 20 * 60 * 1000;

const MODELS = [
  "Stevens Vapor 2x12","Rose Backroad AL","Canyon Grail AL","Ridley Kanzo A",
  "Trek Checkpoint ALR 5","BMC URS AL","Orbea Terra","Scott Speedster Gravel","Focus Atlas"
];

const SOURCES = [
  ["Rebike","https://rebike.com/collections/all-bikes"],
  ["Bike2Future","https://bike2future.de/shop/"],
  ["Buycycle","https://buycycle.com/de-de/shop/bikes"],
  ["BikeExchange","https://www.bikeexchange.de/de-DE/bikes/road-bikes"],
  ["BikeFlip","https://www.bikeflip.com/bikes"],
  ["Stevens","https://www.stevensbikes.de/de/de/bikes/"],
  ["ROSE","https://www.rosebikes.de/fahrr%C3%A4der/gravel"],
  ["Canyon","https://www.canyon.com/de-de/gravel-bikes/"],
  ["Trek","https://www.trekbikes.com/de/de_DE/bikes/rennr%C3%A4der/gravelbikes/c/B546/"],
  ["Ridley","https://www.ridley-bikes.com/de_DE/bikes/gravel"]
];

const clean = v => String(v || "").replace(/\s+/g," ").trim();
const absolute = (href, base) => { try { return new URL(href, base).href; } catch { return ""; } };

function parsePrice(text){
  const t = clean(text).replace(/\./g,"").replace(",",".");
  const vals = [...t.matchAll(/(?:€\s*)?(\d{3,5}(?:\.\d{1,2})?)\s*(?:€|EUR)/gi)]
    .map(m=>Number(m[1])).filter(n=>n>=300&&n<=20000);
  return vals.length ? Math.min(...vals) : null;
}
function modelMatch(text, models){
  const lower=text.toLowerCase(); let best=null,bestScore=0;
  for(const model of models){
    const words=model.toLowerCase().split(/\s+/).filter(w=>w.length>2);
    const score=words.filter(w=>lower.includes(w)).length/Math.max(words.length,1);
    if(score>=0.55&&score>bestScore){best=model;bestScore=score;}
  }
  return best;
}
function sizeInfo(text){
  const t=` ${clean(text).toUpperCase()} `;
  const nums=[...t.matchAll(/\b(58|59|60|61|62)\s*(?:CM)?\b/g)].map(m=>m[1]);
  const letters=[...t.matchAll(/\b(XXL|XL|L)\b/g)].map(m=>m[1]);
  const accepted=nums.some(v=>["59","60","61"].includes(v))||letters.some(v=>["L","XL"].includes(v));
  return {accepted,display:nums.find(v=>["59","60","61"].includes(v))||letters.find(v=>["L","XL"].includes(v))||""};
}
function condition(text){
  const t=text.toLowerCase();
  if(/refurb|generalüberholt|wiederaufbereitet/.test(t)) return "Refurbished";
  if(/gebraucht|used|pre-owned|occasion/.test(t)) return "Gebraucht";
  if(/vorjahr|auslaufmodell|sale|outlet/.test(t)) return "Vorjahresmodell";
  return "Neu";
}
function groupset(text){
  const pats=[/Shimano\s+GRX\s*(?:RX)?\s*820(?:\s*\d+x\d+)?/i,/Shimano\s+GRX\s*(?:RX)?\s*810(?:\s*\d+x\d+)?/i,/SRAM\s+(?:Apex|Rival|Force|Red)\s*(?:AXS)?/i,/Shimano\s+(?:105|Ultegra|Dura-Ace)(?:\s+Di2)?/i];
  return clean(pats.map(p=>text.match(p)?.[0]).find(Boolean)||"");
}
function dedupe(items){
  const m=new Map(); for(const i of items)m.set(`${i.source}|${i.url}`.toLowerCase(),i); return [...m.values()];
}

async function extract(page, source, models){
  const rows=await page.evaluate(()=>[...document.querySelectorAll("a[href]")].map(a=>{const p=a.closest("article,li,[class*='product'],[class*='card'],[class*='bike'],[data-testid]")||a.parentElement;return{href:a.getAttribute("href")||"",text:`${a.innerText||a.textContent||""} ${p?.innerText||p?.textContent||""}`}}).slice(0,2500));
  return dedupe(rows.map(r=>{const text=clean(r.text),model=modelMatch(text,models),url=absolute(r.href,page.url());return model&&/^https?:/.test(url)?{source,model,url}:null;}).filter(Boolean)).slice(0,12);
}

async function inspect(context,c){
  const page=await context.newPage();
  try{
    await page.goto(c.url,{waitUntil:"domcontentloaded",timeout:22000});
    await page.waitForTimeout(900);
    const text=clean(await page.locator("body").innerText({timeout:5000}));
    const size=sizeInfo(text),price=parsePrice(text);
    if(!size.accepted||!price||/ausverkauft|nicht verfügbar|sold out|verkauft|out of stock/i.test(text))return null;
    return {id:crypto.createHash("sha1").update(c.url).digest("hex").slice(0,16),model:c.model,source:c.source,price,oldPrice:null,size:size.display||"passend",condition:condition(text),groupset:groupset(text),url:c.url,checkedAt:new Date().toISOString()};
  }catch{return null;}finally{await page.close().catch(()=>{});}
}

async function scanSource(browser,[name,url],models,job){
  const context=await browser.newContext({locale:"de-DE",viewport:{width:1280,height:900}}); const out=[];
  try{
    job.message=`${name} wird geprüft`;
    const page=await context.newPage();
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000});
    await page.waitForTimeout(1500); await page.mouse.wheel(0,2200).catch(()=>{}); await page.waitForTimeout(600);
    const candidates=await extract(page,name,models); await page.close();
    for(const c of candidates.slice(0,7)){const item=await inspect(context,c);if(item)out.push(item);}
  }catch(e){job.errors.push(`${name}: ${e.message.slice(0,80)}`);}finally{await context.close();}
  return dedupe(out);
}

async function runJob(job,models){
  let browser;
  try{
    browser=await chromium.launch({headless:true}); const all=[];
    for(let i=0;i<SOURCES.length;i++){
      job.progress=Math.round(i/SOURCES.length*90);
      all.push(...await scanSource(browser,SOURCES[i],models,job));
      job.found=dedupe(all).length;
    }
    job.results=dedupe(all).sort((a,b)=>a.price-b.price); job.progress=100; job.status="done"; job.message=`${job.results.length} verfügbare Angebote gefunden`; cache={at:Date.now(),results:job.results};
  }catch(e){job.status="error";job.message=e.message;}finally{await browser?.close().catch(()=>{});setTimeout(()=>jobs.delete(job.id),3600000);}
}

app.get("/api/health",(_req,res)=>res.json({ok:true}));
app.post("/api/search",(req,res)=>{
  const models=Array.isArray(req.body?.models)&&req.body.models.length?req.body.models:MODELS;
  if(!req.body?.force&&Date.now()-cache.at<CACHE_TTL)return res.json({cached:true,results:cache.results});
  const id=crypto.randomUUID(),job={id,status:"running",progress:0,found:0,message:"Suche startet",errors:[],results:[]}; jobs.set(id,job); runJob(job,models); res.status(202).json({jobId:id});
});
app.get("/api/search/:id",(req,res)=>{const job=jobs.get(req.params.id);if(!job)return res.status(404).json({error:"Nicht gefunden"});res.json(job);});
app.get("*",(_req,res)=>res.sendFile(new URL("./index.html",import.meta.url).pathname));
app.listen(PORT,()=>console.log(`GravelRadar auf ${PORT}`));
