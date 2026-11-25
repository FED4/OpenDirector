import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { ProxyOptions } from "vite";

// The local API serves projects, model settings and generation tasks.
const api: Record<string, ProxyOptions> = {
  "/api": {
    target: process.env.OPENDIRECTOR_API_URL ?? "http://127.0.0.1:8000",
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (upstream, _request, response) => {
        // Forward browser cancellation too: transient SAM previews should stop
        // inference when their editor closes, including behind the dev proxy.
        response.on("close", () => {
          if (!response.writableEnded) upstream.destroy();
        });
      });
    },
  },
};

// Machine-local toolchains and project data are not frontend source files.
const ignoredDirectories = [
  "**/.toolchain/**",
  "**/.venv/**",
  "**/projects/**",
  "**/.opendirector/**",
];

export default defineConfig({
  plugins: [react(), {
    name: "html-runtime-policy",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const runtime = request.url?.split("?")[0] === "/html-runtime.html";
        response.setHeader("Content-Security-Policy", runtime
          ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
          : `frame-src http://${request.headers.host}/html-runtime.html; object-src 'none'`);
        next();
      });
    },
  }],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: api,
    watch: { ignored: ignoredDirectories },
  },
  preview: { host: "127.0.0.1", proxy: api },
});
