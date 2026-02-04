const n=self,d="st-higanbana-vfs-";function l(){return new URL("vfs/",n.registration.scope).pathname}function p(t){const e=l(),a=t.pathname;if(!a.startsWith(e))return null;const s=a.slice(e.length),i=s.indexOf("/");if(i<=0)return null;const o=decodeURIComponent(s.slice(0,i)),c=s.slice(i+1);return!o||!c?null:{projectId:o,innerPath:c,vfsBasePath:e}}n.addEventListener("install",t=>{t.waitUntil(n.skipWaiting())});n.addEventListener("activate",t=>{t.waitUntil(n.clients.claim())});n.addEventListener("message",t=>{t.data?.type==="HB_SKIP_WAITING"&&n.skipWaiting()});n.addEventListener("fetch",t=>{const e=t.request;if(e.method!=="GET")return;const a=new URL(e.url),s=p(a);if(!s)return;const i=`${d}${s.projectId}`;t.respondWith((async()=>{const c=await(await caches.open(i)).match(e);if(c)return c;const r=e.headers.get("accept")||"";return e.mode==="navigate"||r.includes("text/html")?new Response(`<!doctype html>
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
