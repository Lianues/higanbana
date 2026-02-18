import{i as w}from"./hbHtmlRuntime.Bjd8jUGb.chunk.js";const s=self,x="st-higanbana-vfs-";function y(){return new URL("vfs/",s.registration.scope).pathname}function v(n){const t=y(),a=n.pathname;if(!a.startsWith(t))return null;const c=a.slice(t.length),i=c.indexOf("/");if(i<=0)return null;const o=decodeURIComponent(c.slice(0,i)),e=c.slice(i+1);return!o||!e?null:{projectId:o,innerPath:e,vfsBasePath:t}}s.addEventListener("install",n=>{n.waitUntil(s.skipWaiting())});s.addEventListener("activate",n=>{n.waitUntil(s.clients.claim())});s.addEventListener("message",n=>{n.data?.type==="HB_SKIP_WAITING"&&s.skipWaiting()});s.addEventListener("fetch",n=>{const t=n.request;if(t.method!=="GET")return;const a=new URL(t.url),c=v(a);if(!c)return;const i=`${x}${c.projectId}`;n.respondWith((async()=>{const e=await(await caches.open(i)).match(t);if(e)try{const l=String(e.headers.get("content-type")||"").toLowerCase(),h=String(t.headers.get("accept")||"").toLowerCase(),p=t.destination,u=t.mode==="navigate"||p==="document",m=l.includes("text/html")||h.includes("text/html");if(!u||!m)return e;const f=await e.clone().text(),g=w(f,{origin:a.origin,forceBaseHref:!1}),r=new Headers(e.headers);return r.get("content-type")||r.set("content-type","text/html; charset=utf-8"),new Response(g,{status:e.status,statusText:e.statusText,headers:r})}catch{return e}const d=t.headers.get("accept")||"";return t.mode==="navigate"||d.includes("text/html")?new Response(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>彼岸花 VFS 404</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.4;margin:20px}
  code{background:rgba(127,127,127,.15);padding:2px 6px;border-radius:6px}
</style>
<h2>资源未找到（VFS）</h2>
<p>请求的文件不在缓存中：<code>${a.pathname}</code></p>
<p>请回到酒馆页面重新导入/允许该角色的 WebZip，或确认入口页引用资源路径是否正确（建议使用相对路径）。</p>`,{status:404,headers:{"Content-Type":"text/html; charset=utf-8"}}):new Response("Not Found",{status:404,headers:{"Content-Type":"text/plain; charset=utf-8"}})})())});
