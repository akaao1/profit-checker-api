"use client";
import {useState} from "react";
const API="https://whkxkdxpndajqkkqmrcu.supabase.co/functions/v1/scan-session-api";
export default function Scan(){
 const[file,setFile]=useState<File|null>(null),[state,setState]=useState<any>(null),[busy,setBusy]=useState(false);
 async function start(){
  if(!file)return;
  setBusy(true);setState({text:"スキャンセッションを準備中…"});
  try{
   const a=await fetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create",area:"akihabara"})}).then(r=>r.json());
   if(!a.ok)throw new Error(a.error);
   const up=await fetch("https://whkxkdxpndajqkkqmrcu.supabase.co/storage/v1/object/upload/sign/store-scan-videos/"+encodeURIComponent(a.upload.path)+"?token="+encodeURIComponent(a.upload.token),{method:"PUT",headers:{"content-type":file.type||"video/webm"},body:file});
   if(!up.ok)throw new Error("動画アップロードに失敗しました");
   setState({text:"アップロード完了。認識パイプライン待機中。",session:a.session,job:a.job});
  }catch(e){setState({text:e instanceof Error?e.message:"エラー"})}finally{setBusy(false)}
 }
 return <main style={{maxWidth:900,margin:"0 auto",padding:"70px 22px"}}>
  <a href="/" style={{color:"#73e8a2"}}>← Radar</a><h1>📹 Store Scan</h1>
  <p style={{color:"#8994a3"}}>店頭動画をアップロードし、カード認識パイプラインへ渡します。</p>
  <div style={{marginTop:30,padding:30,border:"1px solid #29313c",borderRadius:16,background:"#10151c"}}>
   <input type="file" accept="video/*" onChange={e=>setFile(e.target.files?.[0]??null)}/>
   <button disabled={!file||busy} onClick={start} style={{display:"block",marginTop:20,padding:"13px 22px",background:"#73e8a2",border:0,borderRadius:8,fontWeight:800}}>{busy?"処理中…":"スキャンを開始"}</button>
   {file&&<p style={{fontSize:12,color:"#78889a"}}>{file.name} · {(file.size/1024/1024).toFixed(1)} MB</p>}
   {state&&<pre style={{whiteSpace:"pre-wrap",color:"#9ba7b5"}}>{state.text}</pre>}
  </div>
  <p style={{fontSize:11,color:"#667180",marginTop:20}}>※ 現段階では動画保存までを実装済みです。Vision/OCR接続後に自動カード特定へ進みます。</p>
 </main>
}