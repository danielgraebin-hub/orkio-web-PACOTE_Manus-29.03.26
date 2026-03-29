/**
 * ORKIO WEB RUNTIME SERVER
 * server.cjs — consolidated version without external proxy dependency
 *
 * Responsibilities:
 * - serve dist/
 * - expose /env.js runtime config
 * - proxy /api to backend using native http/https
 * - health check endpoint
 */

const express = require("express");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const app = express();

const PORT = Number(process.env.PORT || 8080);
const DIST_DIR = path.join(__dirname, "dist");
const API_BASE_URL = (process.env.API_BASE_URL || "https://web-api-orkio-oficial.up.railway.app").trim().replace(/\/+$/, "");
const API_URL = new URL(API_BASE_URL);
const API_CLIENT = API_URL.protocol === "https:" ? https : http;

function runtimeEnv() {
  return {
    VITE_APP_ENV: process.env.VITE_APP_ENV,
    VITE_DEFAULT_TENANT: process.env.VITE_DEFAULT_TENANT,
    VITE_ORKIO_RUNTIME_MODE: process.env.VITE_ORKIO_RUNTIME_MODE,

    VITE_ENABLE_VOICE: process.env.VITE_ENABLE_VOICE,
    VITE_ENABLE_REALTIME: process.env.VITE_ENABLE_REALTIME,
    VITE_ENABLE_RAG: process.env.VITE_ENABLE_RAG,

    VITE_SUMMIT_VOICE_MODE: process.env.VITE_SUMMIT_VOICE_MODE || process.env.SUMMIT_VOICE_MODE,
    VITE_SUMMIT_LANGUAGE_PROFILE: process.env.VITE_SUMMIT_LANGUAGE_PROFILE,

    VITE_REALTIME_MODEL: process.env.VITE_REALTIME_MODEL,
    VITE_REALTIME_VOICE: process.env.VITE_REALTIME_VOICE,
    VITE_REALTIME_AUTO_RESPONSE_ENABLED: process.env.VITE_REALTIME_AUTO_RESPONSE_ENABLED,
    VITE_REALTIME_PREFER_RAW_MIC: process.env.VITE_REALTIME_PREFER_RAW_MIC,
    VITE_REALTIME_ENABLE_OUTPUT_PICKER: process.env.VITE_REALTIME_ENABLE_OUTPUT_PICKER,
    VITE_REALTIME_VAD_THRESHOLD: process.env.VITE_REALTIME_VAD_THRESHOLD,
    VITE_REALTIME_VAD_SILENCE_MS: process.env.VITE_REALTIME_VAD_SILENCE_MS,
    VITE_REALTIME_VAD_HOLD_MS: process.env.VITE_REALTIME_VAD_HOLD_MS,
    VITE_REALTIME_RESTART_AFTER_TTS_MS: process.env.VITE_REALTIME_RESTART_AFTER_TTS_MS,
    VITE_REALTIME_TRANSCRIBE_LANGUAGE: process.env.VITE_REALTIME_TRANSCRIBE_LANGUAGE,
    VITE_STT_LANGUAGE: process.env.VITE_STT_LANGUAGE,

    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || "/api",
  };
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "orkio-web",
    timestamp: new Date().toISOString(),
  });
});

app.get("/env.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.send(`window.__ORKIO_ENV__ = ${JSON.stringify(runtimeEnv(), null, 2)};`);
});

function proxyApi(req, res) {
  try {
    const targetPath = req.originalUrl || req.url || "/api";
    const headers = { ...req.headers };

    headers.host = API_URL.host;
    headers["x-forwarded-host"] = req.headers.host || "";
    headers["x-forwarded-proto"] = req.protocol || "https";
    headers["x-forwarded-for"] = req.ip || req.socket?.remoteAddress || "";

    const opts = {
      protocol: API_URL.protocol,
      hostname: API_URL.hostname,
      port: API_URL.port || (API_URL.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: targetPath,
      headers,
    };

    const upstream = API_CLIENT.request(opts, (upstreamRes) => {
      res.status(upstreamRes.statusCode || 502);

      for (const [key, value] of Object.entries(upstreamRes.headers || {})) {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      }

      upstreamRes.pipe(res);
    });

    upstream.on("error", (err) => {
      console.error("[server.cjs] proxy error", {
        message: err?.message || String(err),
        target: API_BASE_URL,
        path: targetPath,
      });
      if (!res.headersSent) {
        res.status(502).json({
          detail: "API_PROXY_ERROR",
          target: API_BASE_URL,
          path: targetPath,
        });
      } else {
        try { res.end(); } catch {}
      }
    });

    req.pipe(upstream);
  } catch (err) {
    console.error("[server.cjs] proxy setup failed", err);
    res.status(500).json({ detail: "API_PROXY_SETUP_FAILED" });
  }
}

app.use("/api", proxyApi);

app.use(express.static(DIST_DIR, {
  extensions: ["html"],
  maxAge: "1h",
}));

app.get("*", (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server.cjs] Orkio Web running on port ${PORT}`);
  console.log(`[server.cjs] Proxying /api -> ${API_BASE_URL}`);
});
