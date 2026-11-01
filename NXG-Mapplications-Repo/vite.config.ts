import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { ProxyOptions } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    server: {
      deps: {
        // (decho-elevation itself left with BGWS for its own repo; this still
        // matters because decho-basemap imports a directory — see below.)
        //
        // ⚠ @acc/decho-elevation SHIPS EXTENSIONLESS ESM IMPORTS —
        // `./core/demSource` rather than `./core/demSource.js`. Vite resolves
        // those with bundler semantics, so `vite build` and the browser are
        // fine; Node's own ESM resolver is not, and Vitest hands
        // node_modules to Node untransformed by default. Importing a runtime
        // value from the package in a test therefore fails with "Cannot find
        // module .../core/demSource" while tsc and the app build both pass.
        //
        // Inlining makes Vitest transform it through Vite, which is the same
        // resolution the shipped app gets. The whole @acc/decho- family is
        // covered because elevation's core reaches into decho-basemap for the
        // byte layer, and that one imports a DIRECTORY ("./core"), which Node
        // rejects outright — so inlining elevation alone just moves the error
        // one package along. Scoped to that family: the fix is for their
        // packaging, not a preference about ours.
        inline: [/@acc[/\\]decho-/],
      },
    },
  },
  base:
    process.env.NODE_ENV === "development"
      ? process.env.DEV_SERVER_BASE_PATH
      : undefined,
  server: {
    port: Number(process.env.DEV_SERVER_PORT ?? 8080),
    host: process.env.DEV_SERVER_HOST,
    allowedHosts:
      process.env.DEV_SERVER_DOMAIN != null
        ? [process.env.DEV_SERVER_DOMAIN]
        : undefined,
    proxy: {
      "/api": {
        target: "https://accenture.palantirfoundry.com",
        changeOrigin: true,
        secure: true,
        followRedirects: true,
      },
      "/multipass": {
        target: "https://accenture.palantirfoundry.com",
        changeOrigin: true,
        secure: true,
        followRedirects: true,
      },
      // Foundry S3-compatible API.
      // Do NOT follow redirects — we intercept the 302 Location header
      // in the configure hook and proxy pool-containers ourselves,
      // so the Authorization and Range headers are never dropped.
      "/io": {
        target: "https://accenture.palantirfoundry.com",
        changeOrigin: true,
        secure: true,
        followRedirects: false,
        configure: (proxy) => {
          // When Foundry returns a 302 to pool-containers, rewrite the
          // Location header to go back through our Vite proxy (/pool-s3/...)
          // so the browser never makes a cross-origin request.
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (
              proxyRes.statusCode === 302 ||
              proxyRes.statusCode === 301
            ) {
              const location = proxyRes.headers["location"];
              if (location && location.includes("pool-containers.palantirfoundry.com")) {
                const rewritten = location.replace(
                  "https://pool-containers.palantirfoundry.com",
                  ""  // becomes /io/s3/... relative to our proxy
                );
                // Rewrite to /pool-s3/ prefix so Vite can proxy it
                proxyRes.headers["location"] = rewritten.replace(/^\/io\/s3/, "/pool-s3");
              }
            }
          });
        },
      },
      // Proxy pool-containers requests (after redirect rewrite above)
      // No auth header needed — pool-containers validates via the pre-signed
      // query params that Foundry embeds in the redirect URL.
      // But we DO forward Range so partial content works.
      "/pool-s3": {
        target: "https://pool-containers.palantirfoundry.com",
        changeOrigin: true,
        secure: true,
        followRedirects: true,
        rewrite: (path) => path.replace(/^\/pool-s3/, "/io/s3"),
      },
    },
  },
});
