// @ts-nocheck
import {NextResponse} from "next/server";

export const maxDuration=60;

type ImageBody={
  prompt?:string;
  image?:{name?:string;type?:string;data?:string;width?:number;height?:number};
};

function parseDataUrl(data:string){
  const m=data.match(/^data:([^;]+);base64,(.+)$/s);
  if(!m)return undefined;
  return {mime:m[1],bytes:Buffer.from(m[2],"base64")};
}

function wantsUpscale(prompt:string){
  return /\b(agrand|upscal|haute[- ]définition|haute[- ]definition|haute[- ]résolution|haute[- ]resolution|4k|plus grande|plus grand)\w*/i.test(prompt);
}

function largeSize(width?:number,height?:number){
  const w=Number(width),h=Number(height);
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return "2048x2048";
  const maxPixels=8294400;
  const aspect=Math.max(1/3,Math.min(3,w/h));
  let outW:number,outH:number;
  if(aspect>=1){
    outW=Math.min(3840,Math.floor(Math.sqrt(maxPixels*aspect)/16)*16);
    outH=Math.floor((outW/aspect)/16)*16;
  }else{
    outH=Math.min(3840,Math.floor(Math.sqrt(maxPixels/aspect)/16)*16);
    outW=Math.floor((outH*aspect)/16)*16;
  }
  while(outW*outH>maxPixels){
    if(outW>=outH)outW-=16;else outH-=16;
  }
  return Math.max(816,outW)+"x"+Math.max(816,outH);
}

async function editImageDirect(args:{
  key:string;
  model:string;
  prompt:string;
  bytes:Buffer;
  mime:string;
  filename:string;
  size?:string;
  quality?:"low"|"medium"|"high";
}){
  const form=new FormData();
  const ab=new ArrayBuffer(args.bytes.byteLength);
  new Uint8Array(ab).set(args.bytes);
  form.append("model",args.model);
  form.append("image[]",new Blob([ab],{type:args.mime}),args.filename);
  form.append("prompt",args.prompt);
  if(args.size)form.append("size",args.size);
  if(args.quality)form.append("quality",args.quality);

  const r=await fetch("https://api.openai.com/v1/images/edits",{
    method:"POST",
    headers:{Authorization:`Bearer ${args.key}`},
    body:form
  });
  const data=await r.json().catch(()=>({}));
  return {r,data};
}

export async function POST(req:Request){
  try{
    const key=process.env.OPENAI_API_KEY;
    if(!key)return NextResponse.json({error:"Le moteur d’édition d’image n’est pas configuré."},{status:503});

    const body:ImageBody=await req.json();
    const prompt=String(body.prompt||"").trim();
    const image=body.image;
    if(!prompt)return NextResponse.json({error:"Dis-moi ce que tu veux modifier sur la photo."},{status:400});
    if(!image?.data)return NextResponse.json({error:"Envoie d’abord une photo à modifier."},{status:400});

    const parsed=parseDataUrl(image.data);
    if(!parsed)return NextResponse.json({error:"La photo reçue est illisible."},{status:400});

    const upscale=wantsUpscale(prompt);
    const instruction=[
      "Modifie l’image fournie en suivant exactement la demande de l’utilisateur.",
      "Préserve fidèlement tout ce qui n’est pas explicitement demandé : identité, personnes, pose, cadrage, objets, texte et ambiance.",
      "N’ajoute aucun élément sans demande explicite.",
      upscale?"Agrandis l’image en améliorant la définition et les détails sans changer son contenu.":"",
      "Demande utilisateur : "+prompt
    ].filter(Boolean).join(" ");

    const preferred=process.env.OPENAI_IMAGE_MODEL||(upscale?"gpt-image-2":"gpt-image-2.5-sunburst");
    const size=upscale?largeSize(image.width,image.height):undefined;
    let attempt=await editImageDirect({
      key,
      model:preferred,
      prompt:instruction,
      bytes:parsed.bytes,
      mime:parsed.mime,
      filename:image.name||"photo.jpg",
      size,
      quality:upscale?"high":"medium"
    });

    if(!attempt.r.ok&&preferred!=="gpt-image-2"){
      attempt=await editImageDirect({
        key,
        model:"gpt-image-2",
        prompt:instruction,
        bytes:parsed.bytes,
        mime:parsed.mime,
        filename:image.name||"photo.jpg",
        size,
        quality:upscale?"high":"medium"
      });
    }

    if(!attempt.r.ok){
      const message=attempt.data?.error?.message||"La modification de la photo a échoué.";
      return NextResponse.json({error:message},{status:attempt.r.status||502});
    }

    const b64=attempt.data?.data?.[0]?.b64_json;
    if(!b64)return NextResponse.json({error:"Le moteur d’image n’a pas renvoyé le fichier modifié."},{status:502});

    return NextResponse.json({
      image:"data:image/png;base64,"+b64,
      mime:"image/png",
      filename:"alexia-photo-modifiee.png"
    });
  }catch(err){
    const message=err instanceof Error?err.message:"Impossible de modifier la photo.";
    return NextResponse.json({error:message},{status:500});
  }
}
