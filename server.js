// Minimal web proxy. Node 18+ (uses built-in fetch). No dependencies.
// Usage: node server.js  ->  http://localhost:8080
const http = require("http");
const dns = require("dns").promises;
const net = require("net");

const PORT = process.env.PORT || 8080;

const HOME = `<!doctype html><meta charset="utf-8"><title>Proxy</title>
<style>body{font-family:system-ui;max-width:520px;margin:15vh auto;text-align:center}
input{width:70%;padding:10px;font-size:16px}button{padding:10px 16px;font-size:16px}</style>
<h2>Web Proxy</h2>
<form onsubmit="go(event)"><input id="u" placeholder="example.com or search term" autofocus>
<button>Go</button></form>
<script>
function go(e){e.preventDefault();let v=document.getElementById('u').value.trim();
if(!v)return;
if(!/^https?:\\/\\//i.test(v)) v = v.includes('.')&&!v.includes(' ') ? 'https://'+v
  : 'https://search.brave.com/search?q='+encodeURIComponent(v);
location.href='/p/'+encodeURIComponent(v);}
</script>`;

// Browser-style address bar injected at the top of every proxied HTML page.
const BAR = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#222;padding:6px;display:flex;gap:6px;font-family:system-ui">
<button onclick="history.back()">&larr;</button><button onclick="history.forward()">&rarr;</button><button onclick="location.reload()">&#8635;</button>
<button onclick="location.href='/'">Home</button>
<form style="flex:1;display:flex" onsubmit="event.preventDefault();var v=this.q.value.trim();if(!v)return;
if(!/^https?:\\/\\//i.test(v))v=v.includes('.')&&!v.includes(' ')?'https://'+v:'https://search.brave.com/search?q='+encodeURIComponent(v);
location.href='/p/'+encodeURIComponent(v)">
<input name="q" placeholder="Search Brave or enter address" style="flex:1;padding:6px;border-radius:6px;border:0"></form></div><div style="height:44px"></div>`;

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
    .replace(/\bsrcset=("[^"]*")/gi, "") // drop srcset for simplicity
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<body[^>]*>/i, (m) => m + BAR);
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
    if (req.url === "/" ) {
      res.writeHead(200, { "content-type": "text/html" });
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
    let out = buf;
    if (type.includes("text/html")) out = Buffer.from(rewriteHtml(buf.toString("utf8"), url.href));
    else if (type.includes("text/css")) out = Buffer.from(rewriteCss(buf.toString("utf8"), url.href));

    res.writeHead(upstream.status, headers);
    res.end(out);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Proxy error: " + e.message);
  }
}).listen(PORT, () => console.log("Proxy running on port " + PORT));
