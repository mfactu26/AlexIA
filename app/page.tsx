"use client";
import {FormEvent,useEffect,useRef,useState} from "react";

type Msg={id:string;role:"user"|"assistant";content:string;pending?:boolean};
type Att={name:string;type:string;data:string};
type Loc={lat:number;lon:number;accuracy?:number};
type SpeechRecognitionEventLike={results:{[key:number]:{[key:number]:{transcript:string}}}};
type SendOptions={forceLocation?:boolean;forceWebSearch?:boolean};

function uid(prefix:string){
  try{return prefix+crypto.randomUUID()}catch{return prefix+Date.now()+"-"+Math.random().toString(36).slice(2)}
}
function cleanVoiceText(t:string){
  return t
    .replace(/(?:\*\*|astérisque(?:s)?|asterisque(?:s)?)/gi," ")
    .replace(/\s+([,.;:!?])/g,"$1")
    .replace(/\s{2,}/g," ")
    .trim();
}
function cleanSpeechText(t:string){
  return t
    .replace(/\*\*(.*?)\*\*/g,"$1")
    .replace(/[*#_]/g,"")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu," ")
    .replace(/[\uFE0F\u200D]/g,"")
    .replace(/^\s*[-•]\s*/gm,"")
    .replace(/\s{2,}/g," ")
    .trim();
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
      {enableHighAccuracy:false,timeout:5000,maximumAge:300000}
    );
  });
}
function normalizeStored(raw:any):Msg[]{
  if(!Array.isArray(raw))return [];
  return raw
    .filter((m:any)=>(m?.role==="user"||m?.role==="assistant")&&typeof m?.content==="string")
    .map((m:any)=>({id:uid("old-"),role:m.role,content:m.content}));
}

export default function Home(){
  const[mode,setMode]=useState<"Chat"|"Work">("Chat");
  const[messages,setMessages]=useState<Msg[]>([]);
  const[input,setInput]=useState("");
  const[pendingCount,setPendingCount]=useState(0);
  const[error,setError]=useState("");
  const[listening,setListening]=useState(false);
  const[voice,setVoice]=useState(true);
  const[files,setFiles]=useState<Att[]>([]);
  const[locationState,setLocationState]=useState<"idle"|"ok"|"denied">("idle");
  const[webSearchNext,setWebSearchNext]=useState(false);
  const end=useRef<HTMLDivElement>(null);
  const messagesRef=useRef<Msg[]>([]);
  const photoInput=useRef<HTMLInputElement>(null);

  function commitMessages(updater:(prev:Msg[])=>Msg[]){
    const next=updater(messagesRef.current);
    messagesRef.current=next;
    setMessages(next);
  }

  useEffect(()=>{
    try{
      const loaded=normalizeStored(JSON.parse(localStorage.getItem("alexia-history")||"[]"));
      messagesRef.current=loaded;
      setMessages(loaded);
    }catch{}
  },[]);
  useEffect(()=>{
    const saved=messages.filter(m=>!m.pending).map(({role,content})=>({role,content}));
    localStorage.setItem("alexia-history",JSON.stringify(saved));
    end.current?.scrollIntoView({behavior:"smooth"});
  },[messages]);

  function speak(text:string){
    if(!voice||typeof window==="undefined")return;
    const spoken=cleanSpeechText(text);
    if(!spoken)return;
    const a=(window as any).AlexiaAndroid;
    if(a?.speak){a.speak(spoken);return}
    if(!("speechSynthesis" in window))return;
    window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(spoken);
    u.lang="fr-FR";
    window.speechSynthesis.speak(u);
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

  async function send(e?:FormEvent,spoken?:string,options:SendOptions={}){
    e?.preventDefault();
    const text=cleanVoiceText(spoken??input);
    const attachments=[...files];
    if(!text&&!attachments.length)return;

    const shown=text||(attachments.length?"Analyse "+attachments.map(f=>f.name).join(", "):"");
    const requestId=uid("req-");
    const userMsg:Msg={id:uid("u-"),role:"user",content:shown};
    const pendingMsg:Msg={id:requestId,role:"assistant",content:"Je réfléchis…",pending:true};

    const context=messagesRef.current
      .filter(m=>!m.pending)
      .map(({role,content})=>({role,content}));
    const requestMessages=[...context,{role:"user" as const,content:shown}];

    commitMessages(prev=>[...prev,userMsg,pendingMsg]);
    setInput("");
    setFiles([]);
    setError("");
    setPendingCount(v=>v+1);

    const forceWebSearch=options.forceWebSearch||webSearchNext;
    if(webSearchNext)setWebSearchNext(false);

    try{
      let location:Loc|undefined;
      if(options.forceLocation||wantsLocation(text)){
        location=await getDeviceLocation();
        setLocationState(location?"ok":"denied");
        if(!location&&options.forceLocation)throw new Error("Active la localisation pour utiliser le GPS.");
      }

      const q=await fetch("/api/chat",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({messages:requestMessages,mode,attachments,location,forceWebSearch})
      });

      if(!q.ok){
        let message="Erreur IA";
        try{const data=await q.json();message=data.error||message}catch{}
        throw new Error(message);
      }

      if(!q.body){
        const data=await q.json();
        const reply=data.reply||"Je n'ai pas reçu de réponse exploitable.";
        commitMessages(prev=>prev.map(m=>m.id===requestId?{...m,content:reply,pending:false}:m));
        speak(reply);
        return;
      }

      const reader=q.body.getReader();
      const decoder=new TextDecoder();
      let reply="";
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        const chunk=decoder.decode(value,{stream:true});
        if(!chunk)continue;
        reply+=chunk;
        const snapshot=reply;
        commitMessages(prev=>prev.map(m=>m.id===requestId?{...m,content:snapshot,pending:false}:m));
      }
      reply+=decoder.decode();
      if(!reply.trim())reply="Je n'ai pas reçu de réponse exploitable.";
      commitMessages(prev=>prev.map(m=>m.id===requestId?{...m,content:reply,pending:false}:m));
      speak(reply);
    }catch(err){
      const message=err instanceof Error?err.message:"Erreur de connexion";
      commitMessages(prev=>prev.map(m=>m.id===requestId?{...m,content:"Je n’ai pas pu terminer cette demande : "+message,pending:false}:m));
      setError(message);
    }finally{
      setPendingCount(v=>Math.max(0,v-1));
    }
  }

  useEffect(()=>{
    (window as any).__alexiaVoiceResult=(t:string)=>{setListening(false);setInput(t);send(undefined,t)};
    (window as any).__alexiaVoiceError=()=>{setListening(false);setError("Je n’ai pas pu entendre. Réessayez.")};
    return()=>{delete (window as any).__alexiaVoiceResult;delete (window as any).__alexiaVoiceError}
  },[mode,files,voice,webSearchNext]);

  function listen(){
    const a=(window as any).AlexiaAndroid;
    if(a?.listen){setListening(true);a.listen();return}
    const w=window as any,R=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!R){setError("Reconnaissance vocale indisponible.");return}
    const x=new R();
    x.lang="fr-FR";
    x.onstart=()=>setListening(true);
    x.onend=()=>setListening(false);
    x.onerror=()=>setError("Je n’ai pas pu entendre.");
    x.onresult=(e:SpeechRecognitionEventLike)=>send(undefined,e.results[0][0].transcript);
    x.start();
  }

  function reset(){
    messagesRef.current=[];
    setMessages([]);
    setFiles([]);
    setPendingCount(0);
    setWebSearchNext(false);
    localStorage.removeItem("alexia-history");
    window.speechSynthesis?.cancel();
  }

  function quickWeather(){send(undefined,"Quel temps fait-il là où je suis ?",{forceLocation:true})}
  function quickPosition(){send(undefined,"Où suis-je actuellement ? Donne-moi ma ville et ma zone approximative.",{forceLocation:true})}
  function quickSearch(){setWebSearchNext(v=>!v);setTimeout(()=>document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),0)}

  const status=pendingCount>0
    ?"● "+pendingCount+" tâche"+(pendingCount>1?"s":"")+" en cours"
    :locationState==="ok"?"● GPS actif":"● En ligne";
  const footer=pendingCount>0
    ?"AlexIA continue "+pendingCount+" tâche"+(pendingCount>1?"s":"")+" en parallèle"
    :webSearchNext?"Recherche Web activée pour le prochain message"
    :"Voix • GPS • photos • documents • Web";

  return <main>
    <aside>
      <div className="brand"><div className="brand-orb">A✦</div><div><h1>AlexIA</h1><p>Votre IA personnelle</p></div></div>
      <nav><button className={mode==="Chat"?"active":""} onClick={()=>setMode("Chat")}>💬 Chat</button><button className={mode==="Work"?"active":""} onClick={()=>setMode("Work")}>⚡ Work</button><button onClick={reset}>◷ Nouvelle conversation</button><button>⌘ Connexions</button></nav>
    </aside>
    <section>
      <header>
        <div className="mobile-menu">☰</div>
        <div className="header-brand"><div className="mini-orb">A</div><div><b>Alex<span>IA</span></b><small>{mode==="Work"?"Mission autonome":"Conversation intelligente"}</small></div></div>
        <i>{status}</i>
      </header>

      {messages.length===0?
        <div className="hero"><div className="orb">A✦</div><h2>Bonjour, je suis AlexIA.</h2><p>Parlez-moi naturellement. Je peux utiliser le GPS, le Web, la voix, des photos et des documents.</p></div>
        :
        <div className="conversation">{messages.map(m=><div key={m.id} className={"msg "+m.role+(m.pending?" pending":"")}><b>{m.role==="user"?"Vous":"AlexIA"}</b><p>{m.pending?<><span className="thinking-dot">●</span> {m.content}</>:renderMessage(m.content)}</p></div>)}<div ref={end}/></div>
      }

      <div className="quick-actions" aria-label="Fonctions rapides">
        <button type="button" onClick={quickWeather}><span>☁</span>Météo</button>
        <button type="button" onClick={quickPosition}><span>⌖</span>Position</button>
        <button type="button" onClick={()=>photoInput.current?.click()}><span>▣</span>Photo</button>
        <button type="button" className={webSearchNext?"active":""} onClick={quickSearch}><span>⌕</span>Recherche</button>
      </div>

      <form className="composer" onSubmit={send}>
        <input ref={photoInput} type="file" accept="image/*" style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/>
        <label title="Joindre photo ou document">📎<input type="file" accept="image/*,.pdf,.txt" multiple style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/></label>
        {files.length>0&&<div className="attachments">{files.map((f,i)=><button type="button" key={i} onClick={()=>setFiles(v=>v.filter((_,j)=>j!==i))}>📎 {f.name} ×</button>)}</div>}
        <textarea
          value={input}
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}
          placeholder={listening?"Je vous écoute…":pendingCount>0?"Posez une autre question…":webSearchNext?"Rechercher sur le Web…":"Écrivez ou parlez à AlexIA…"}
        />
        <button type="button" className={"send mic"+(listening?" listening":"")} onClick={listen} aria-label="Parler">{listening?"◉":"🎤"}</button>
        <button className="send" aria-label="Envoyer">➜</button>
        <button type="button" className="voice" onClick={()=>setVoice(v=>!v)} aria-label="Activer ou couper la voix">{voice?"🔊":"🔇"}</button>
        {error?<small className="error">{error}</small>:<small>{footer}</small>}
      </form>
    </section>
  </main>
}
