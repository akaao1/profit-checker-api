"use client";
import {useState} from "react";

const API="https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/scan-session-api";
const STORAGE="https://whkxkdxpndajqkkqmrcu.supabase.co/storage/v1/object/upload/sign/store-scan-videos/";
const MAX_FRAMES=80;

async function jsonFetch(input:any,init?:any):Promise<any>{
 const r=await fetch(input,init);
 const data=await r.json().catch(()=>({}));
 if(!r.ok||data.ok===false)throw new Error(data.error||`HTTP ${r.status}`);
 return data;
}
function sha256Hex(buffer:any):Promise<string>{
 return crypto.subtle.digest("SHA-256",buffer).then(hash=>Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join(""));
}
function blobFromCanvas(canvas:any):Promise<any>{
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("フレーム画像の生成に失敗しました")),"image/jpeg",0.82));
}
function seek(video:any,time:number):Promise<void>{
 return new Promise<void>((resolve,reject)=>{
  const done=()=>{cleanup();resolve()};
  const fail=()=>{cleanup();reject(new Error("動画フレームの読み込みに失敗しました"))};
  const cleanup=()=>{video.removeEventListener("seeked",done);video.removeEventListener("error",fail)};
  video.addEventListener("seeked",done,{once:true});
  video.addEventListener("error",fail,{once:true});
  video.currentTime=time;
 });
}
async function loadVideo(url:string):Promise<any>{
 const video=document.createElement("video");
 video.preload="metadata";
 video.muted=true;
 video.playsInline=true;
 video.src=url;
 await new Promise<void>((resolve,reject)=>{
  const ok=()=>{cleanup();resolve()};
  const bad=()=>{cleanup();reject(new Error("動画メタデータを読み込めませんでした"))};
  const cleanup=()=>{video.removeEventListener("loadedmetadata",ok);video.removeEventListener("error",bad)};
  video.addEventListener("loadedmetadata",ok,{once:true});
  video.addEventListener("error",bad,{once:true});
 });
 return video;
}
export default function Scan(){
 const[file,setFile]=useState<File|null>(null),[state,setState]=useState<any>(null),[busy,setBusy]=useState(false);
 async function start(){
  if(!file)return;
  setBusy(true);
  setState({text:"スキャンセッションを準備中…"});
  const objectUrl=URL.createObjectURL(file);
  try{
   const a=await jsonFetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create",area:"akihabara"})});
   const up=await fetch(STORAGE+encodeURIComponent(a.upload.path)+"?token="+encodeURIComponent(a.upload.token),{method:"PUT",headers:{"content-type":file.type||"video/webm"},body:file});
   if(!up.ok)throw new Error("動画アップロードに失敗しました");
   await jsonFetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"video_uploaded",session_id:a.session.id,video_path:a.upload.path})});
   setState({text:"動画保存完了。フレームを抽出しています…",session:a.session,job:a.job});
   
   const video=await loadVideo(objectUrl);
   const duration=Math.max(0,Number(video.duration)||0);
   if(!duration)throw new Error("動画の長さを取得できませんでした");
   const frameCount=Math.min(MAX_FRAMES,Math.max(1,Math.ceil(duration/1.5)));
   const interval=duration/frameCount;
   const canvas=document.createElement("canvas");
   const scale=Math.min(1,1280/Math.max(1,video.videoWidth));
   canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
   canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
   const samples:any[]=[];
   for(let i=0;i<frameCount;i++){
    const sec=Math.min(duration-0.05,Math.max(0,i*interval));
    await seek(video,sec);
    const ctx=canvas.getContext("2d");
    if(!ctx)throw new Error("Canvasを初期化できませんでした");
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await blobFromCanvas(canvas);
    const hash=await sha256Hex(await blob.arrayBuffer());
    if(!samples.some(x=>x.hash===hash))samples.push({timestamp_ms:Math.round(sec*1000),blob,hash});
    setState({text:`フレーム抽出中… ${i+1}/${frameCount}`,session:a.session,job:a.job});
   }
   URL.revokeObjectURL(objectUrl);
   if(!samples.length)throw new Error("保存できるフレームがありませんでした");
   
   const urls=await jsonFetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"frame_upload_urls",session_id:a.session.id,timestamps_ms:samples.map(x=>x.timestamp_ms)})});
   const byTs:any=new Map(urls.uploads.map((x:any)=>[Number(x.timestamp_ms),x]));
   let uploaded=0;
   const workers=Array.from({length:Math.min(4,samples.length)},async()=>{
    while(true){
     const index=uploaded++;
     if(index>=samples.length)return;
     const sample=samples[index],target=byTs.get(sample.timestamp_ms);
     if(!target)throw new Error("フレーム署名URLが不足しています");
     const put=await fetch(STORAGE+encodeURIComponent(target.path)+"?token="+encodeURIComponent(target.token),{method:"PUT",headers:{"content-type":"image/jpeg"},body:sample.blob});
     if(!put.ok)throw new Error(`フレーム ${index+1} の保存に失敗しました`);
     setState({text:`フレーム保存中… ${index+1}/${samples.length}`,session:a.session,job:a.job});
    }
   });
   await Promise.all(workers);
   
   const frames=samples.map(x=>({timestamp_ms:x.timestamp_ms,image_path:byTs.get(x.timestamp_ms)?.path,image_hash:x.hash}));
   const done=await jsonFetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"frames",session_id:a.session.id,frames})});
   setState({text:`フレーム抽出完了。認識待ちです（${done.frame_count}フレーム）。`,session:done.session,job:done.job});
  }catch(e){
   URL.revokeObjectURL(objectUrl);
   setState({text:e instanceof Error?e.message:"エラー"});
  }finally{setBusy(false)}
 }
 return <main style={{maxWidth:900,margin:"0 auto",padding:"70px 22px"}}>
  <a href="/" style={{color:"#73e8a2"}}>← Radar</a><h1>📹 Store Scan</h1>
  <p style={{color:"#8994a3"}}>店頭動画を保存し、代表フレームを自動抽出して認識パイプラインへ渡します。</p>
  <div style={{marginTop:30,padding:30,border:"1px solid #29313c",borderRadius:16,background:"#10151c"}}>
   <input type="file" accept="video/*" onChange={e=>setFile(e.target.files?.[0]??null)}/>
   <button disabled={!file||busy} onClick={start} style={{display:"block",marginTop:20,padding:"13px 22px",background:"#73e8a2",border:0,borderRadius:8,fontWeight:800}}>{busy?"処理中…":"スキャンを開始"}</button>
   {file&&<p style={{fontSize:12,color:"#78889a"}}>{file.name} · {(file.size/1024/1024).toFixed(1)} MB</p>}
   {state&&<pre style={{whiteSpace:"pre-wrap",color:"#9ba7b5"}}>{state.text}</pre>}
  </div>
  <p style={{fontSize:11,color:"#667180",marginTop:20}}>※ 現在は動画→フレーム抽出まで自動化済みです。次段でVision/OCRによるカード特定を接続します。</p>
 </main>
}