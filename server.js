
// Emnity server: static frontend + Ultraviolet assets + Wisp websocket relay.
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import wisp from "wisp-server-node";

dns.setDefaultResultOrder("ipv4first");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

async function resolveDir(pkg, exportName, entry = pkg) {
  try {
    const mod = await import(entry);
    const val = mod[exportName] ?? mod.default?.[exportName];
    if (typeof val === "string" && fs.existsSync(val)) return val;
  } catch {}
  return path.join(__dirname, "node_modules", pkg, "dist");
}

const uvPath = await resolveDir("@titaniumnetwork-dev/ultraviolet", "uvPath");
const epoxyPath = await resolveDir("@mercuryworkshop/epoxy-transport", "epoxyPath");
const libcurlPath = await resolveDir("@mercuryworkshop/libcurl-transport", "libcurlPath");
const baremuxPath = await resolveDir(
  "@mercuryworkshop/bare-mux",
  "baremuxPath",
  "@mercuryworkshop/bare-mux/node"
);

for (const [name, dir] of Object.entries({ uvPath, epoxyPath, libcurlPath, baremuxPath })) {
  console.log(`[emnity] ${name}: ${dir} ${fs.existsSync(dir) ? "(ok)" : "(MISSING)"}`);
}

try {
  Object.assign(wisp.options, {
    allow_loopback_ips: false,
    allow_private_ips: false,
    allow_udp_streams: false,
    dns_method: "lookup",
    dns_result_order: "ipv4first",
  });
} catch (err) {
  console.warn("[emnity] could not set wisp options:", err.message);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// ---------- ACCESS CODES ----------
const ACCESS_CODES = new Map([
  ["lma", 30 * 24 * 60 * 60 * 1000],
  ["legacy", 60 * 60 * 1000],
]);

const sha = (value) =>
  crypto.createHash("sha256").update(value).digest();

const DEVICE_COOKIE_NAME = "emn_device";
const DEVICE_COOKIE_SECRET = String(process.env.DEVICE_COOKIE_SECRET || "");

if (DEVICE_COOKIE_SECRET.length < 32) {
  throw new Error(
    "DEVICE_COOKIE_SECRET must be set and contain at least 32 characters."
  );
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(String(a)), sha(String(b)));
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";

  for (const part of header.split(";")) {
    const i = part.indexOf("=");

    if (i > 0 && part.slice(0, i).trim() === name) {
      return part.slice(i + 1).trim();
    }
  }

  return "";
}

function signValue(value) {
  return crypto
    .createHmac("sha256", DEVICE_COOKIE_SECRET)
    .update(value)
    .digest("hex");
}

function signDeviceId(id) {
  return signValue("device:" + id);
}

function getDeviceId(req) {
  const value = readCookie(req, DEVICE_COOKIE_NAME);
  const dot = value.lastIndexOf(".");

  if (dot < 1) return null;

  const id = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return null;
  if (!/^[a-f0-9]{64}$/.test(signature)) return null;

  const expected = signDeviceId(id);

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex")
  ) ? id : null;
}

function ensureDeviceId(req, res) {
  const existing = getDeviceId(req);

  if (existing) return existing;

  const id = crypto.randomBytes(24).toString("base64url");
  const value = `${id}.${signDeviceId(id)}`;
  const secure = req.secure ? "; Secure" : "";

  res.append(
    "Set-Cookie",
    `${DEVICE_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`
  );

  return id;
}

function createAuthCookie(deviceId, expiresAt) {
  const payload = Buffer.from(
    JSON.stringify({ deviceId, expiresAt })
  ).toString("base64url");

  return `${payload}.${signValue("auth:" + payload)}`;
}

function isAuthed(req) {
  const deviceId = getDeviceId(req);

  if (!deviceId) return false;

  const value = readCookie(req, "emn_auth");
  const dot = value.lastIndexOf(".");

  if (dot < 1) return false;

  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  if (!/^[a-f0-9]{64}$/.test(signature)) return false;

  const expected = signValue("auth:" + payload);

  if (!crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex")
  )) return false;

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    return (
      session.deviceId === deviceId &&
      Number.isSafeInteger(session.expiresAt) &&
      session.expiresAt > Date.now()
    );
  } catch {
    return false;
  }
}

// ---------- LOGIN RATE LIMITING ----------
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const DEVICE_ATTEMPT_LIMIT = 10;
const IP_ATTEMPT_LIMIT = 60;

function tooManyTries(key, limit) {
  const rec = attempts.get(key);

  if (!rec || Date.now() - rec.start > WINDOW_MS) return false;

  return rec.count >= limit;
}

function noteFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);

  if (!rec || now - rec.start > WINDOW_MS) {
    attempts.set(key, { start: now, count: 1 });
  } else {
    rec.count++;
  }
}

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;

  for (const [key, rec] of attempts) {
    if (rec.start < cutoff) attempts.delete(key);
  }
}, 60 * 1000).unref();

// ---------- LOGIN PAGE ----------
function loginPage(message) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emnity</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{
 margin:0;min-height:100vh;display:flex;flex-direction:column;
 align-items:center;justify-content:center;gap:18px;
 background:#e6e8e8;color:#0b0b0b;
 font-family:"Nunito",system-ui,sans-serif
}
h1{margin:0;font-size:64px;letter-spacing:-1px;font-weight:800}
h1 i{font-style:normal;color:#14b8a6}
p{margin:0;color:#4b5454;font-weight:600}
form{
 display:flex;width:min(380px,90vw);background:#fff;
 border-radius:28px;border:2px solid transparent;
 box-shadow:0 2px 0 #d4d8d8
}
form:focus-within{border-color:#14b8a6}
input{
 flex:1;min-width:0;border:0;outline:0;background:transparent;
 font:inherit;font-size:16px;font-weight:600;
 padding:14px 20px;border-radius:28px 0 0 28px
}
button{
 border:0;background:#0b0b0b;color:#14b8a6;
 font:inherit;font-weight:800;padding:0 24px;
 border-radius:0 26px 26px 0;cursor:pointer
}
button:hover{background:#0d9488;color:#fff}
.err{color:#b3261e;min-height:1.2em}
</style>
</head>
<body>
<h1>Emn<i>i</i>ty</h1>
<p>Enter the access code.</p>
<form method="post" action="/login">
<input type="password" name="code" placeholder="Access code"
autocomplete="off" autofocus aria-label="Access code">
<button>Enter</button>
</form>
<p class="err">${message || ""}</p>
</body>
</html>`;
}

// ---------- ROUTES ----------
app.get("/healthz", (_req, res) => {
  res.type("text").send("ok");
});

// The frontend polls this endpoint to detect expired sessions.
app.get("/session-status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ authenticated: isAuthed(req) });
});

app.post(
  "/login",
  express.urlencoded({ extended: false, limit: "1kb" }),
  (req, res) => {
    const deviceId = ensureDeviceId(req, res);
    const ipKey = `ip:${req.ip || "unknown"}`;
    const deviceKey = `device:${deviceId}`;

    if (
      tooManyTries(deviceKey, DEVICE_ATTEMPT_LIMIT) ||
      tooManyTries(ipKey, IP_ATTEMPT_LIMIT)
    ) {
      return res.status(429).type("html").send(
        loginPage("Too many tries. Wait a few minutes.")
      );
    }

    const given = String(
      (req.body && req.body.code) || ""
    ).trim().toLowerCase();

    let durationMs = 0;

    for (const [code, duration] of ACCESS_CODES) {
      if (safeEqual(given, code)) {
        durationMs = duration;
        break;
      }
    }

    if (durationMs > 0) {
      const expiresAt = Date.now() + durationMs;
      const authCookie = createAuthCookie(deviceId, expiresAt);
      const secure = req.secure ? "; Secure" : "";

      res.append(
        "Set-Cookie",
        `emn_auth=${authCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(durationMs / 1000)}${secure}`
      );

      return res.redirect(303, "/");
    }

    noteFailure(deviceKey);
    noteFailure(ipKey);

    return res.status(401).type("html").send(
      loginPage("That code isn't right.")
    );
  }
);

// ---------- AUTHENTICATION ----------
app.use((req, res, next) => {
  if (isAuthed(req)) return next();

  if (req.method === "GET" && req.path === "/") {
    ensureDeviceId(req, res);
    return res.type("html").send(loginPage(""));
  }

  return res.status(401).type("text").send(
    "Locked. Open the main page and enter the access code."
  );
});

// ---------- STATIC FILES ----------
app.use("/uv/sw.js", (_req, res, next) => {
  res.set("Cache-Control", "no-cache");
  res.set("Service-Worker-Allowed", "/uv/service/");
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremux/", express.static(baremuxPath));

app.use("/uv/service/", (_req, res) => {
  res.status(503).type("html").send(
    '<body style="font-family:system-ui;background:#e6e8e8;text-align:center;padding-top:15vh">' +
    '<h2 style="color:#0d9488">Emnity is still starting</h2>' +
    "<p>The browser engine wasn't ready yet. Go back to the Emnity page and try again.</p>" +
    '<p><a href="/">Open Emnity</a></p></body>'
  );
});

app.use((_req, res) => {
  res.status(404).type("text").send("Not found");
});

// ---------- SERVER ----------
const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => {});

  if (!isAuthed(req)) {
    socket.destroy();
    return;
  }

  if (req.url && req.url.endsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen({ port: PORT, host: "0.0.0.0" }, () => {
  console.log(`[emnity] running on port ${PORT}`);
});

function shutdown() {
  console.log("[emnity] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
