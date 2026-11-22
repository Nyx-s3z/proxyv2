// Emnity server: static frontend + Ultraviolet assets + Wisp websocket relay.
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { fileURLToPath } from "node:url";
import express from "express";
import wisp from "wisp-server-node";

// Some hosts have no working IPv6 route out; prefer IPv4 so connections don't hang.
dns.setDefaultResultOrder("ipv4first");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

// Each package exports the folder holding its browser files. If an export is
// missing in a future version, fall back to node_modules/<pkg>/dist.
async function resolveDir(pkg, exportName, entry = pkg) {
  try {
    const mod = await import(entry);
    const val = mod[exportName] ?? mod.default?.[exportName];
    if (typeof val === "string" && fs.existsSync(val)) return val;
  } catch {
    // fall through to the default location
  }
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

// Wisp is the relay that opens the real connections to websites. Keep it away
// from the host's own network. Options are set defensively in case names change.
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

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// Service worker must never be cached for long so updates apply.
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

// Reaching this means the service worker was not controlling the request.
app.use("/uv/service/", (_req, res) => {
  res
    .status(503)
    .type("html")
    .send(
      '<body style="font-family:system-ui;background:#e6e8e8;text-align:center;padding-top:15vh">' +
        '<h2 style="color:#0d9488">Emnity is still starting</h2>' +
        "<p>The browser engine wasn't ready yet. Go back to the Emnity page and try again.</p>" +
        '<p><a href="/">Open Emnity</a></p></body>'
    );
});

app.use((_req, res) => res.status(404).type("text").send("Not found"));

const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => {});
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
