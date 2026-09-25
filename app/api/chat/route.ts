import {NextResponse} from "next/server";
type Msg={role:"user"|"assistant";content:string};
export async function POST(req:Request){
 try{
  const key=process.env.OPENAI_API_KEY;if(!key)return NextResponse.json({error:"Le moteur IA n'est pas encore configuré : ajoutez OPENAI_API_KEY dans Vercel."},{status:503});
  const body=await req.json();const messages:Array<Msg>=Array.isArray(body.messages)?body.messages.slice(-30):[];const mode=body.mode==="Work"?"Work":"Chat";
  const instructions=mode==="Work"?"Tu es AlexIA, une IA personnelle en mode Work. Structure les missions en étapes concrètes, vérifie les hypothèses, signale clairement ce qui nécessite un outil ou une autorisation et ne prétends jamais avoir exécuté une action que tu n'as pas exécutée. Réponds en français par défaut.":"Tu es AlexIA, une IA personnelle utile, concise et fiable. Réponds en français par défaut. N'invente jamais une action externe que tu n'as pas réellement exécutée.";
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5.6",instructions,input:messages.map(m=>({role:m.role,content:m.content}))})});
  const data=await r.json();if(!r.ok)return NextResponse.json({error:data?.error?.message||"Erreur du fournisseur IA"},{status:r.status});
  const reply=data.output_text||data.output?.flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text).join("\n")||"Je n'ai pas reçu de réponse exploitable.";
  return NextResponse.json({reply});
 }catch{return NextResponse.json({error:"Impossible de traiter la demande."},{status:500})}
}