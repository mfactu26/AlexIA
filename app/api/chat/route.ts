import {NextResponse} from "next/server";
type Msg={role:"user"|"assistant";content:string};
const hits=new Map<string,{count:number;reset:number}>();
function allowed(req:Request){
 const origin=req.headers.get("origin"),host=req.headers.get("host");
 if(origin&&host&&!origin.endsWith(host))return false;
 const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"local",now=Date.now(),slot=hits.get(ip);
 if(!slot||slot.reset<now){hits.set(ip,{count:1,reset:now+60_000});return true}
 if(slot.count>=20)return false;slot.count++;return true;
}
export async function POST(req:Request){
 try{
  if(!allowed(req))return NextResponse.json({error:"Trop de requêtes. Réessayez dans une minute."},{status:429});
  const key=process.env.OPENAI_API_KEY;if(!key)return NextResponse.json({error:"Le moteur IA n'est pas configuré."},{status:503});
  const body=await req.json();const raw:Array<Msg>=Array.isArray(body.messages)?body.messages:[];const messages=raw.slice(-30).filter(m=>(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").map(m=>({...m,content:m.content.slice(0,12000)}));
  if(!messages.length)return NextResponse.json({error:"Message manquant."},{status:400});
  const mode=body.mode==="Work"?"Work":"Chat";
  const instructions=mode==="Work"?"Tu es AlexIA, une IA personnelle en mode Work. Structure les missions en étapes concrètes, vérifie les hypothèses, signale clairement ce qui nécessite un outil ou une autorisation et ne prétends jamais avoir exécuté une action que tu n'as pas exécutée. Réponds en français par défaut. Utilise le contexte de la conversation comme mémoire de travail.":"Tu es AlexIA, une IA personnelle utile, concise et fiable. Réponds en français par défaut. Utilise le contexte de la conversation comme mémoire de travail. N'invente jamais une action externe que tu n'as pas réellement exécutée.";
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5.6",instructions,input:messages,max_output_tokens:1800})});
  const data=await r.json();if(!r.ok)return NextResponse.json({error:data?.error?.message||"Erreur du fournisseur IA"},{status:r.status});
  const reply=data.output_text||data.output?.flatMap((o:{content?:Array<{type?:string;text?:string}>})=>o.content||[]).filter((c:{type?:string})=>c.type==="output_text").map((c:{text?:string})=>c.text||"").join("\n")||"Je n'ai pas reçu de réponse exploitable.";
  return NextResponse.json({reply});
 }catch{return NextResponse.json({error:"Impossible de traiter la demande."},{status:500})}
}