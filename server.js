// Emnity - minimal tabbed web proxy. Node 18+ (uses built-in fetch). No dependencies.
const http = require("http");
const dns = require("dns").promises;
const net = require("net");

const PORT = process.env.PORT || 8080;

const HOME = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emnity</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
button,input,select{font-family:inherit}
:root{--gray:#e6e8e8;--gray2:#d4d8d8;--teal:#14b8a6;--teal-d:#0d9488;--black:#0b0b0b;--ink2:#1c1f1f}
*{box-sizing:border-box}
html,body{margin:0;height:100%;font-family:"Nunito",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--gray);color:var(--black)}
body{display:flex;flex-direction:column;overflow:hidden}
#tabbar{background:var(--black);display:flex;align-items:flex-end;gap:2px;padding:6px 8px 0;height:42px;flex:none}
#brand{color:var(--teal);font-weight:700;letter-spacing:.5px;padding:0 12px 9px 4px;font-size:15px}
#tabs{display:flex;gap:2px;align-items:flex-end;min-width:0;flex:0 1 auto;overflow:hidden}
.tab{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px 0 14px;min-width:60px;max-width:200px;flex:0 1 200px;
 background:var(--ink2);color:#9aa3a3;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;border-top:2px solid transparent}
.tab:hover{color:#fff}
.tab.on{background:var(--gray);color:var(--black);border-top-color:var(--teal)}
.tab span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.tab b{font-weight:400;width:18px;height:18px;line-height:17px;text-align:center;border-radius:50%;flex:none}
.tab b:hover{background:var(--teal);color:var(--black)}
#plus{background:none;border:0;color:var(--teal);font-size:22px;cursor:pointer;height:34px;width:34px;border-radius:8px}
#plus:hover{background:var(--ink2)}
#bar{background:var(--gray);display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--gray2);flex:none}
#bar button{background:transparent;border:0;color:var(--black);font-size:17px;width:34px;height:34px;border-radius:8px;cursor:pointer}
#bar button:hover{background:var(--gray2)}
#addr{flex:1;height:34px;border:2px solid transparent;background:#f4f6f6;border-radius:17px;padding:0 16px;font-size:14px;color:var(--black);outline:none}
#eng{height:34px;border:2px solid transparent;background:var(--black);color:var(--teal);border-radius:17px;padding:0 10px;font-size:13px;cursor:pointer;outline:none}
#addr:focus{border-color:var(--teal);background:#fff}
#views{flex:1;position:relative;background:#fff}
#views iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
#start{position:absolute;inset:0;background:var(--gray);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:20px}
#start h1{margin:0;font-size:68px;letter-spacing:-1px;font-weight:800}
#start h1 i{font-style:normal;color:var(--teal)}
#start p{margin:0;color:#4b5454;font-size:15px}
#sform{display:flex;width:min(560px,92vw);background:#fff;border-radius:28px;border:2px solid transparent;box-shadow:0 2px 0 var(--gray2)}
#sform:focus-within{border-color:var(--teal)}
#sform input{flex:1;border:0;outline:0;background:transparent;font-size:16px;padding:14px 20px;border-radius:28px 0 0 28px}
#sform button{border:0;background:var(--black);color:var(--teal);font-weight:600;font-size:15px;padding:0 24px;border-radius:0 26px 26px 0;cursor:pointer}
#sform button:hover{background:var(--teal-d);color:#fff}
</style></head><body>
<div id="tabbar"><div id="brand">EMNITY</div><div id="tabs"></div><button id="plus" title="New tab">+</button></div>
<div id="bar">
<button id="back" title="Back">&#8592;</button><button id="fwd" title="Forward">&#8594;</button>
<button id="reload" title="Reload">&#8635;</button><button id="home" title="Home">&#8962;</button>
<input id="addr" placeholder="Search or enter address" autocomplete="off" spellcheck="false">
<select id="eng" title="Search engine"><option value="brave">Brave</option><option value="ddg">DuckDuckGo</option>
<option value="google">Google</option><option value="bing">Bing</option><option value="startpage">Startpage</option><option value="mojeek">Mojeek</option></select>
</div>
<div id="views">
<div id="start"><h1>Emn<i>i</i>ty</h1><p>Search or enter an address. Pick your search engine at the top right.</p>
<form id="sform"><input id="sq" placeholder="Search or enter address" autocomplete="off"><button>Go</button></form></div>
</div>
<script>
var tabs=[],cur=null,n=0;
function $(id){return document.getElementById(id)}
function norm(v){v=v.trim();if(!v)return"";
 if(v.indexOf("http://")==0||v.indexOf("https://")==0)return v;
 if(v.indexOf(".")>0&&v.indexOf(" ")<0)return "https://"+v;
 return (ENG[$("eng").value]||ENG.brave)+encodeURIComponent(v);}
var ENG={brave:"https://search.brave.com/search?q=",ddg:"https://html.duckduckgo.com/html/?q=",
 google:"https://www.google.com/search?q=",bing:"https://www.bing.com/search?q=",
 startpage:"https://www.startpage.com/do/search?q=",mojeek:"https://www.mojeek.com/search?q="};
try{var saved=localStorage.getItem("emn_eng");if(saved&&ENG[saved])$("eng").value=saved}catch(e){}
$("eng").onchange=function(){try{localStorage.setItem("emn_eng",this.value)}catch(e){}};
function curTab(){for(var i=0;i<tabs.length;i++)if(tabs[i].id==cur)return tabs[i];return null}
function newTab(u){var f=document.createElement("iframe");$("views").appendChild(f);
 var t={id:++n,title:"New tab",url:"",frame:f};tabs.push(t);
 f.addEventListener("load",function(){sync(t)});
 cur=t.id;if(u)go(t,u);else render();return t}
function go(t,v){var u=norm(v);if(!u)return;t.url=u;t.title=u;
 t.frame.src="/p/"+encodeURIComponent(u);cur=t.id;render()}
function sync(t){try{var w=t.frame.contentWindow,p=w.location.pathname;
 if(p.indexOf("/p/")==0){t.url=decodeURIComponent(p.slice(3));
  var d=w.document.title;t.title=d||t.url}}catch(e){}render()}
function closeTab(id){var i=0;for(;i<tabs.length;i++)if(tabs[i].id==id)break;
 var t=tabs[i];t.frame.remove();tabs.splice(i,1);
 if(!tabs.length){newTab();return}
 if(cur==id)cur=tabs[Math.max(0,i-1)].id;render()}
function render(){var box=$("tabs");box.innerHTML="";
 tabs.forEach(function(t){var d=document.createElement("div");d.className="tab"+(t.id==cur?" on":"");
  var s=document.createElement("span");s.textContent=t.url?t.title:"New tab";
  var x=document.createElement("b");x.textContent="\\u00d7";
  x.onclick=function(e){e.stopPropagation();closeTab(t.id)};
  d.onclick=function(){cur=t.id;render()};d.appendChild(s);d.appendChild(x);box.appendChild(d);
  t.frame.style.display=(t.id==cur&&t.url)?"block":"none"});
 var c=curTab();$("start").style.display=(c&&!c.url)?"flex":"none";
 if(document.activeElement!==$("addr"))$("addr").value=c&&c.url?c.url:"";
 document.title=c&&c.url?c.title+" - Emnity":"Emnity"}
$("plus").onclick=function(){newTab()};
$("addr").onkeydown=function(e){if(e.key=="Enter"){var t=curTab();go(t,this.value);this.blur()}};
$("addr").onfocus=function(){this.select()};
$("sform").onsubmit=function(e){e.preventDefault();var v=$("sq").value;$("sq").value="";go(curTab(),v)};
$("back").onclick=function(){try{curTab().frame.contentWindow.history.back()}catch(e){}};
$("fwd").onclick=function(){try{curTab().frame.contentWindow.history.forward()}catch(e){}};
$("reload").onclick=function(){try{curTab().frame.contentWindow.location.reload()}catch(e){}};
$("home").onclick=function(){var t=curTab();t.url="";t.title="New tab";t.frame.src="about:blank";render()};
newTab();
</script></body></html>`;

// Block requests to private/internal addresses (SSRF protection).
function isPrivate(ip) {
  if (net.isIPv6(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}
async function safeUrl(u) {
  const url = new URL(u);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
  const { address } = await dns.lookup(url.hostname);
  if (isPrivate(address)) throw new Error("blocked address");
  return url;
}

const wrap = (abs) => "/p/" + encodeURIComponent(abs);
function rewriteHtml(html, base) {
  const fix = (v) => {
    try {
      if (/^(data:|javascript:|mailto:|#|blob:)/i.test(v)) return v;
      return wrap(new URL(v, base).href);
    } catch { return v; }
  };
  return html
    .replace(/\b(href|src|action|poster)=("([^"]*)"|'([^']*)')/gi, (m, attr, q, d, s) => {
      const quote = q[0];
      return `${attr}=${quote}${fix(d ?? s)}${quote}`;
    })
    .replace(/\bsrcset=("[^"]*")/gi, "")
    .replace(/\btarget=("_blank"|'_blank')/gi, 'target="_self"')
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
}
function rewriteCss(css, base) {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, v) => {
    try {
      if (v.startsWith("data:")) return m;
      return `url(${wrap(new URL(v, base).href)})`;
    } catch { return m; }
  });
}

http.createServer(async (req, res) => {
  try {
    if (req.url === "/" || req.url.startsWith("/?")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(HOME);
    }
    if (!req.url.startsWith("/p/")) { res.writeHead(404); return res.end("Not found"); }

    const target = decodeURIComponent(req.url.slice(3));
    const url = await safeUrl(target);

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const upstream = await fetch(url, {
      method: req.method,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      redirect: "manual",
      headers: {
        "user-agent": req.headers["user-agent"] || "Mozilla/5.0",
        accept: req.headers.accept || "*/*",
        "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
        "sec-fetch-site": "none",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "content-type": req.headers["content-type"] || undefined,
      },
    });

    const headers = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-security-policy", "x-frame-options", "content-encoding",
            "content-length", "transfer-encoding", "set-cookie", "location"].includes(k)) headers[k] = v;
    });

    const loc = upstream.headers.get("location");
    if (loc) {
      headers.location = wrap(new URL(loc, url).href);
      res.writeHead(upstream.status, headers);
      return res.end();
    }

    const type = upstream.headers.get("content-type") || "";
    const buf = Buffer.from(await upstream.arrayBuffer());
    console.log(upstream.status, url.hostname + url.pathname, buf.length + " bytes");

    const wantsPage = (req.headers.accept || "").includes("text/html");
    if (wantsPage && (buf.length < 300 || (upstream.status >= 400 && !type.includes("text/html")))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(
        '<body style="font-family:Nunito,system-ui,sans-serif;background:#e6e8e8;color:#0b0b0b;text-align:center;padding-top:15vh">' +
        '<h2 style="color:#0d9488">This site sent back nothing usable</h2>' +
        "<p>" + url.hostname + " answered with status <b>" + upstream.status + "</b> and " + buf.length + " bytes.</p>" +
        "<p>Status 403 or 429 usually means it blocked the request. Try another search engine.</p></body>"
      );
    }
    let out = buf;
    if (type.includes("text/html")) out = Buffer.from(rewriteHtml(buf.toString("utf8"), url.href));
    else if (type.includes("text/css")) out = Buffer.from(rewriteCss(buf.toString("utf8"), url.href));

    res.writeHead(upstream.status, headers);
    res.end(out);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Proxy error: " + e.message);
  }
}).listen(PORT, () => console.log("Emnity running on port " + PORT));
