import {NextResponse} from "next/server";

type Msg={role:"user"|"assistant";content:string};
type Att={name:string;type:string;data:string};
type Loc={lat:number;lon:number;accuracy?:number};

const hits=new Map<string,{count:number;reset:number}>();

function allowed(req:Request){
  const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"local";
  const now=Date.now(),slot=hits.get(ip);
  if(!slot||slot.reset<now){hits.set(ip,{count:1,reset:now+60000});return true}
  if(slot.count>=20)return false;
  slot.count++;
  return true;
}
function safeLocation(v:any):Loc|undefined{
  if(!v||!Number.isFinite(v.lat)||!Number.isFinite(v.lon))return undefined;
  if(v.lat<-90||v.lat>90||v.lon<-180||v.lon>180)return undefined;
  return {lat:Number(v.lat),lon:Number(v.lon),accuracy:Number.isFinite(v.accuracy)?Number(v.accuracy):undefined};
}
function isWeatherQuestion(t:string){return /\b(météo|meteo|quel temps|temps fait|température|temperature|pluie|vent|prévisions|previsions)\b/i.test(t)}
function isLocationQuestion(t:string){return /\b(où suis|ou suis|ma position|localisation|près de moi|pres de moi|autour de moi|ici)\b/i.test(t)}
function extractPlace(history:Msg[]){
  for(let i=history.length-1;i>=0;i--){
    const m=history[i]; if(m.role!=="user")continue;
    const t=m.content;
    let x=t.match(/\b(?:météo|meteo|temps)\b[^.!?]{0,35}\b(?:à|a|pour|sur)\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,4})/i);
    if(!x)x=t.match(/\b(?:je suis|j'habite|je me trouve)\s+(?:à|a|sur)\s+([A-Za-zÀ-ÿ'’-]+(?:\s+[A-Za-zÀ-ÿ'’-]+){0,4})/i);
    if(x){
      return x[1].replace(/\s+dans\s+(?:le|la|les)\s+.*$/i,"").replace(/\s+(?:aujourd'hui|demain|maintenant).*$/i,"").trim();
    }
  }
  return "";
}
async function reversePlace(loc:Loc){
  try{
    const url=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(loc.lat)}&lon=${encodeURIComponent(loc.lon)}&zoom=10&accept-language=fr`;
    const r=await fetch(url,{headers:{"User-Agent":"AlexIA/1.2 personal assistant"}});
    if(!r.ok)return "";
    const d=await r.json();
    const a=d?.address||{};
    const city=a.city||a.town||a.village||a.municipality||a.county||"";
    const region=a.state||a.region||"";
    const country=a.country||"";
    return [city,region,country].filter(Boolean).join(", ");
  }catch{return ""}
}
async function geocodePlace(name:string):Promise<{lat:number;lon:number;label:string}|undefined>{
  if(!name)return undefined;
  try{
    const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=fr&format=json`);
    if(!r.ok)return undefined;
    const d=await r.json();
    const list=Array.isArray(d?.results)?d.results:[];
    const best=list.find((x:any)=>x.country_code==="FR")||list[0];
    if(!best||!Number.isFinite(best.latitude)||!Number.isFinite(best.longitude))return undefined;
    return {lat:best.latitude,lon:best.longitude,label:[best.name,best.admin1,best.country].filter(Boolean).join(", ")};
  }catch{return undefined}
}
function weatherLabel(code:number){
  if(code===0)return "ciel dégagé";
  if([1,2].includes(code))return "partiellement nuageux";
  if(code===3)return "couvert";
  if([45,48].includes(code))return "brouillard";
  if([51,53,55,56,57].includes(code))return "bruine";
  if([61,63,65,66,67,80,81,82].includes(code))return "pluie";
  if([71,73,75,77,85,86].includes(code))return "neige";
  if([95,96,99].includes(code))return "orage";
  return "conditions variables";
}
async function weatherContext(lat:number,lon:number,label:string){
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`;
    const r=await fetch(url,{next:{revalidate:600}});
    if(!r.ok)return "";
    const d=await r.json();
    const c=d?.current||{},daily=d?.daily||{};
    const today={max:daily.temperature_2m_max?.[0],min:daily.temperature_2m_min?.[0],rain:daily.precipitation_probability_max?.[0],code:daily.weather_code?.[0]};
    const tomorrow={max:daily.temperature_2m_max?.[1],min:daily.temperature_2m_min?.[1],rain:daily.precipitation_probability_max?.[1],code:daily.weather_code?.[1]};
    return [
      `Lieu: ${label||"position GPS de l'utilisateur"}.`,
      `Conditions actuelles: ${c.temperature_2m} °C, ressenti ${c.apparent_temperature} °C, ${weatherLabel(Number(c.weather_code))}, vent ${c.wind_speed_10m} km/h, précipitations ${c.precipitation} mm.`,
      `Aujourd'hui: min ${today.min} °C, max ${today.max} °C, risque de pluie ${today.rain} %, ${weatherLabel(Number(today.code))}.`,
      tomorrow.max!==undefined?`Demain: min ${tomorrow.min} °C, max ${tomorrow.max} °C, risque de pluie ${tomorrow.rain} %, ${weatherLabel(Number(tomorrow.code))}.`:""
    ].filter(Boolean).join(" ");
  }catch{return ""}
}

export async function POST(req:Request){
  try{
    if(!allowed(req))return NextResponse.json({error:"Trop de requêtes. Réessayez dans une minute."},{status:429});
    const key=process.env.OPENAI_API_KEY;
    if(!key)return NextResponse.json({error:"Le moteur IA n'est pas configuré."},{status:503});

    const body=await req.json();
    const raw:Msg[]=Array.isArray(body.messages)?body.messages:[];
    const history=raw.slice(-30).filter(m=>(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").map(m=>({role:m.role,content:m.content.slice(0,12000)}));
    if(!history.length)return NextResponse.json({error:"Message manquant."},{status:400});

    const atts:Att[]=Array.isArray(body.attachments)?body.attachments.slice(0,4):[];
    const last=history[history.length-1];
    const weather=isWeatherQuestion(last.content);
    const locationQuestion=isLocationQuestion(last.content);
    let loc=safeLocation(body.location);
    let locationLabel="";
    const context:string[]=[];

    if(loc){
      locationLabel=await reversePlace(loc);
      context.push(`Position fournie par l'application: ${locationLabel||"coordonnées GPS disponibles"}.`);
    }else if(weather){
      const place=extractPlace(history);
      const found=await geocodePlace(place);
      if(found){loc={lat:found.lat,lon:found.lon};locationLabel=found.label}
    }

    if(weather&&loc){
      const w=await weatherContext(loc.lat,loc.lon,locationLabel);
      if(w)context.push("Données météo en direct: "+w);
    }else if(locationQuestion&&loc&&!locationLabel){
      locationLabel=await reversePlace(loc);
      if(locationLabel)context.push("Lieu estimé depuis le GPS: "+locationLabel+".");
    }

    const input:any[]=history.slice(0,-1);
    const parts:any[]=[{type:"input_text",text:last.content}];
    for(const a of atts){
      if(typeof a?.data!=="string"||a.data.length>12000000)continue;
      if((a.type||"").startsWith("image/"))parts.push({type:"input_image",image_url:a.data});
      else if(a.type==="application/pdf"||a.type==="text/plain")parts.push({type:"input_file",filename:a.name||"document",file_data:a.data});
    }
    input.push({role:"user",content:parts});

    const mode=body.mode==="Work"?"Work":"Chat";
    const base=mode==="Work"
      ?"Tu es AlexIA en mode Work. Analyse aussi les pièces jointes. Structure les missions, sois factuelle et ne prétends jamais avoir exécuté une action non exécutée. Réponds en français."
      :"Tu es AlexIA, une IA personnelle utile, concise et fiable. Analyse les images et documents joints quand ils sont présents. Réponds en français par défaut.";
    const live=context.length
      ?"\nContexte temps réel fourni par l'application, à utiliser comme source prioritaire pour cette réponse: "+context.join(" ")+" Ne dis pas que tu n'as pas accès à la localisation ou à la météo si ces données sont présentes."
      :"\nSi une donnée temps réel n'est réellement pas disponible, dis-le brièvement sans inventer.";
    const instructions=base+live+"\nTu peux utiliser un peu de Markdown pour la lisibilité, mais reste naturel et concis.";

    const q=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5.6",instructions,input,max_output_tokens:1800})});
    const data=await q.json();
    if(!q.ok)return NextResponse.json({error:data?.error?.message||"Erreur du fournisseur IA"},{status:q.status});
    const reply=data.output_text||data.output?.flatMap((o:any)=>o.content||[]).filter((c:any)=>c.type==="output_text").map((c:any)=>c.text||"").join("\n")||"Je n'ai pas reçu de réponse exploitable.";
    return NextResponse.json({reply});
  }catch{
    return NextResponse.json({error:"Impossible de traiter la demande."},{status:500});
  }
}
