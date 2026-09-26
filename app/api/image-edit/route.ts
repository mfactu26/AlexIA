import {NextResponse} from "next/server";

export const maxDuration=60;

type ImageBody={
  prompt?:string;
  image?:{name?:string;type?:string;data?:string;width?:number;height?:number};
};

function wantsUpscale(prompt:string){
  return /\b(agrand|upscal|haute[- ]définition|haute[- ]definition|haute[- ]résolution|haute[- ]resolution|4k|plus grande|plus grand)\w*/i.test(prompt);
}

function extractImage(data:any){
  const item=(data?.output||[]).find((x:any)=>x?.type==="image_generation_call"&&typeof x?.result==="string");
  return item?.result||"";
}

async function editImage(args:{key:string;parentModel:string;imageModel:string;prompt:string;imageData:string;upscale:boolean}){
  const tool:any={type:"image_generation",model:args.imageModel};
  if(args.upscale&&args.imageModel==="gpt-image-2"){
    tool.quality="high";
  }
  const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${args.key}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.parentModel,
      input:[{
        role:"user",
        content:[
          {type:"input_text",text:args.prompt},
          {type:"input_image",image_url:args.imageData,detail:"auto"}
        ]
      }],
      tools:[tool],
      tool_choice:{type:"image_generation"}
    })
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
    if(!image?.data||!image.data.startsWith("data:image/"))return NextResponse.json({error:"Envoie d’abord une photo à modifier."},{status:400});

    const upscale=wantsUpscale(prompt);
    const instruction=[
      "Modifie l’image fournie en suivant exactement la demande de l’utilisateur.",
      "Préserve fidèlement tout ce qui n’est pas explicitement demandé : personnes, identité, pose, cadrage, objets, texte et style général.",
      "N’ajoute aucun élément sans demande explicite.",
      upscale?"La demande implique un agrandissement : améliore la définition et les détails tout en conservant exactement le contenu et la composition.":"",
      "Demande utilisateur : "+prompt
    ].filter(Boolean).join(" ");

    const imageModel=process.env.OPENAI_IMAGE_MODEL||(upscale?"gpt-image-2":"gpt-image-2.5-sunburst");
    const primaryParent=process.env.OPENAI_IMAGE_PARENT_MODEL||"gpt-6-astra";
    let attempt=await editImage({key,parentModel:primaryParent,imageModel,prompt:instruction,imageData:image.data,upscale});

    if(!attempt.r.ok&&primaryParent!=="gpt-5.6"){
      attempt=await editImage({key,parentModel:process.env.OPENAI_MODEL||"gpt-5.6",imageModel,prompt:instruction,imageData:image.data,upscale});
    }
    if(!attempt.r.ok&&imageModel!=="gpt-image-2"){
      attempt=await editImage({key,parentModel:primaryParent,imageModel:"gpt-image-2",prompt:instruction,imageData:image.data,upscale});
    }

    if(!attempt.r.ok){
      const message=attempt.data?.error?.message||"La modification de la photo a échoué.";
      return NextResponse.json({error:message},{status:attempt.r.status||502});
    }

    const b64=extractImage(attempt.data);
    if(!b64)return NextResponse.json({error:"Le moteur n’a retourné aucune image modifiée."},{status:502});

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
