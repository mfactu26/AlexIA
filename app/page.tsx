"use client";
import {FormEvent,useEffect,useRef,useState} from "react";

type Msg={role:"user"|"assistant";content:string};
type Att={name:string;type:string;data:string};
type Loc={lat:number;lon:number;accuracy?:number};
type SpeechRecognitionEventLike={results:{[key:number]:{[key:number]:{transcript:string}}}};

function cleanVoiceText(t:string){
  return t
    .replace(/(?:\*\*|astérisque(?:s)?|asterisque(?:s)?)/gi," ")
    .replace(/\s+([,.;:!?])/g,"$1")
    .replace(/\s{2,}/g," ")
    .trim();
}
function cleanSpeechText(t:string){
  return t.replace(/\*\*(.*?)\*\*/g,"$1").replace(/[*#_`]/g,"").replace(/^\s*[-•]\s*/gm,"").trim();
}
function wantsLocation(t:string){
  return /\b(météo|meteo|quel temps|temps fait|où suis|ou suis|ma position|localisation|près de moi|pres de moi|autour de moi|ici)\b/i.test(t);
}
function renderMessage(text:string){
  const lines=text.split("\n");
  return lines.map((line,li)=><span key={li}>{line.split(/(\*\*[^*]+\*\*)/g).map((part,pi)=>part.startsWith("**")&&part.endsWith("**")?<strong key={pi}>{part.slice(2,-2)}</strong>:<span key={pi}>{part}</span>)}{li<lines.length-1?<br/>:null}</span>);
}
function getDeviceLocation():Promise<Loc|undefined>{
  return new Promise(resolve=>{
    if(typeof navigator==="undefined"||!navigator.geolocation){resolve(undefined);return;}
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}),
      ()=>resolve(undefined),
      {enableHighAccuracy:true,timeout:8000,maximumAge:120000}
    );
  });
}

export default function Home(){
  const[mode,setMode]=useState<"Chat"|"Work">("Chat");
  const[messages,setMessages]=useState<Msg[]>([]);
  const[input,setInput]=useState("");
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  const[listening,setListening]=useState(false);
  const[voice,setVoice]=useState(true);
  const[files,setFiles]=useState<Att[]>([]);
  const[locationState,setLocationState]=useState<"idle"|"ok"|"denied">("idle");
  const end=useRef<HTMLDivElement>(null);

  useEffect(()=>{try{setMessages(JSON.parse(localStorage.getItem("alexia-history")||"[]"))}catch{}},[]);
  useEffect(()=>{localStorage.setItem("alexia-history",JSON.stringify(messages));end.current?.scrollIntoView({behavior:"smooth"})},[messages]);

  function speak(text:string){
    if(!voice||typeof window==="undefined")return;
    const spoken=cleanSpeechText(text);
    const a=(window as any).AlexiaAndroid;
    if(a?.speak){a.speak(spoken);return}
    if(!("speechSynthesis" in window))return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(spoken);u.lang="fr-FR";window.speechSynthesis.speak(u);
  }

  async function addFiles(list:FileList|null){
    if(!list)return;
    setError("");
    const chosen=Array.from(list).slice(0,4);
    const out:Att[]=[];
    for(const f of chosen){
      if(f.size>8*1024*1024){setError(f.name+" dépasse 8 Mo.");continue}
      const data=await new Promise<string>((ok,no)=>{const x=new FileReader();x.onload=()=>ok(String(x.result));x.onerror=()=>no(x.error);x.readAsDataURL(f)});
      out.push({name:f.name,type:f.type||"application/octet-stream",data});
    }
    setFiles(v=>[...v,...out].slice(0,4));
  }

  async function send(e?:FormEvent,spoken?:string){
    e?.preventDefault();
    const text=cleanVoiceText(spoken??input);
    if((!text&&!files.length)||busy)return;
    const shown=text||(files.length?"Analyse "+files.map(f=>f.name).join(", "):"");
    const next=[...messages,{role:"user" as const,content:shown}];
    const attachments=files;
    setMessages(next);setInput("");setBusy(true);setError("");setFiles([]);
    try{
      let location:Loc|undefined;
      if(wantsLocation(text)){
        location=await getDeviceLocation();
        setLocationState(location?"ok":"denied");
      }
      const q=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:next,mode,attachments,location})});
      const data=await q.json();
      if(!q.ok)throw new Error(data.error||"Erreur IA");
      setMessages([...next,{role:"assistant",content:data.reply}]);
      speak(data.reply);
    }catch(err){
      setError(err instanceof Error?err.message:"Erreur de connexion");
    }finally{setBusy(false)}
  }

  useEffect(()=>{
    (window as any).__alexiaVoiceResult=(t:string)=>{setListening(false);setInput(t);send(undefined,t)};
    (window as any).__alexiaVoiceError=()=>{setListening(false);setError("Je n’ai pas pu entendre. Réessayez.")};
    return()=>{delete (window as any).__alexiaVoiceResult;delete (window as any).__alexiaVoiceError}
  },[messages,busy,mode,files]);

  function listen(){
    const a=(window as any).AlexiaAndroid;
    if(a?.listen){setListening(true);a.listen();return}
    const w=window as any,R=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!R){setError("Reconnaissance vocale indisponible.");return}
    const x=new R();x.lang="fr-FR";x.onstart=()=>setListening(true);x.onend=()=>setListening(false);x.onerror=()=>setError("Je n’ai pas pu entendre.");x.onresult=(e:SpeechRecognitionEventLike)=>send(undefined,e.results[0][0].transcript);x.start();
  }

  function reset(){setMessages([]);setFiles([]);localStorage.removeItem("alexia-history");window.speechSynthesis?.cancel()}

  return <main>
    <aside>
      <div className="logo">A<span>✦</span></div><h1>AlexIA</h1><p>Votre IA personnelle</p>
      <nav><button className={mode==="Chat"?"active":""} onClick={()=>setMode("Chat")}>💬 Chat</button><button className={mode==="Work"?"active":""} onClick={()=>setMode("Work")}>⚡ Work</button><button onClick={reset}>◷ Nouvelle conversation</button><button>⌘ Connexions</button></nav>
    </aside>
    <section>
      <header><div><b>{mode}</b><small>{mode==="Work"?"Mission autonome":"Conversation intelligente"}</small></div><i>{locationState==="ok"?"● GPS actif":"● disponible"}</i></header>
      {messages.length===0?
        <div className="hero"><div className="orb">A✦</div><h2>Bonjour, je suis AlexIA.</h2><p>Écrivez, parlez, envoyez une photo ou un document.</p><div className="chips"><button onClick={()=>setInput("Quel temps fait-il là où je suis ?")}>📍 Météo autour de moi</button><button onClick={()=>setInput("Aide-moi à continuer mes projets")}>Continuer mes projets</button></div></div>
        :
        <div className="conversation">{messages.map((m,i)=><div key={i} className={"msg "+m.role}><b>{m.role==="user"?"Vous":"AlexIA"}</b><p>{renderMessage(m.content)}</p></div>)}{busy&&<div className="msg assistant"><b>AlexIA</b><p>Je réfléchis…</p></div>}<div ref={end}/></div>
      }
      <form className="composer" onSubmit={send}>
        <label title="Joindre photo ou document">📎<input type="file" accept="image/*,.pdf,.txt" multiple style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/></label>
        {files.length>0&&<div className="attachments">{files.map((f,i)=><button type="button" key={i} onClick={()=>setFiles(v=>v.filter((_,j)=>j!==i))}>📎 {f.name} ×</button>)}</div>}
        <textarea value={input} onChange={e=>setInput(e.target.value)} placeholder={listening?"Je vous écoute…":"Écrivez ou parlez à AlexIA…"}/>
        <button type="button" className="send mic" onClick={listen} aria-label="Parler">{listening?"◉":"🎤"}</button>
        <button className="send" disabled={busy} aria-label="Envoyer">➜</button>
        <button type="button" className="voice" onClick={()=>setVoice(v=>!v)} aria-label="Activer ou couper la voix">{voice?"🔊":"🔇"}</button>
        {error?<small className="error">{error}</small>:<small>AlexIA • voix, GPS et pièces jointes prêts</small>}
      </form>
    </section>
  </main>
}
