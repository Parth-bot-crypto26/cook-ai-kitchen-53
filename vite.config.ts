import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, mergeConfig, type Plugin, type UserConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// This project runs on Vite + TanStack Start. The dev-only plugins below
// (server-fn / SSR error logging) forward runtime errors to the Vite HMR
// websocket so they surface as an overlay in the browser console instead of
// only in the terminal — purely a local developer-experience nicety.

const SSR_CAPTURE_KEY = "__START_CAPTURE_SSR_ERROR__";
const HANDLER_RAN_KEY = "__START_HANDLER_RAN__";

/** Surfaces uncaught SSR errors (including ones h3 would otherwise swallow) in the dev overlay. */
function devSsrErrorLogger(): Plugin {
  let lastCapture: { error: unknown; at: number } | undefined;
  const CAPTURE_TTL_MS = 5000;
  const handlerRanFlag = Symbol("handlerRan");

  const capture = (error: unknown) => {
    lastCapture = { error, at: Date.now() };
  };
  const consumeCapture = () => {
    if (!lastCapture) return undefined;
    if (Date.now() - lastCapture.at > CAPTURE_TTL_MS) {
      lastCapture = undefined;
      return undefined;
    }
    const { error } = lastCapture;
    lastCapture = undefined;
    return error;
  };

  return {
    name: "dev-ssr-error-logger",
    apply: "serve",
    configureServer(server) {
      (globalThis as any)[SSR_CAPTURE_KEY] = capture;
      (globalThis as any)[HANDLER_RAN_KEY] = (event: any) => {
        const res = event?.node?.res;
        if (res) res[handlerRanFlag] = true;
      };
      const g = globalThis as any;
      if (typeof g.addEventListener === "function") {
        g.addEventListener("error", (e: any) => capture(e.error ?? e));
        g.addEventListener("unhandledrejection", (e: any) => capture(e.reason));
      }
      const onUnhandledRejection = (reason: unknown) => capture(reason);
      process.on("unhandledRejection", onUnhandledRejection);
      server.httpServer?.once("close", () => {
        process.off("unhandledRejection", onUnhandledRejection);
      });

      server.middlewares.use((req, res, next) => {
        let handled = false;
        const handleErrorResponse = () => {
          if (handled || res.statusCode < 500) return;
          handled = true;
          const captured = consumeCapture();
          const ranHandler = Boolean((res as any)[handlerRanFlag]);
          const where = [req.method, req.url].filter(Boolean).join(" ") || "the request";
          let data: Record<string, unknown>;
          if (captured instanceof Error) {
            data = { name: captured.name, message: captured.message, stack: captured.stack };
          } else if (typeof captured === "string" && captured.length > 0) {
            data = { name: "Error", message: captured };
          } else if (ranHandler) {
            data = {
              message: `The app returned ${res.statusCode} while handling ${where}. The error was handled by a route or error boundary, so no stack was captured — check the failing loader/route code and the dev server output.`,
            };
          } else {
            data = {
              message: `Dev server returned ${res.statusCode} for ${where} before the app handler ran. This is usually a Vite build/transform error — check the dev server output for the underlying error.`,
            };
          }
          try {
            server.ws.send({ type: "custom", event: "server-ssr-error", data });
          } catch {
            // best-effort only
          }
        };
        const origWriteHead = res.writeHead.bind(res);
        res.writeHead = (...args: any[]) => {
          if (typeof args[0] === "number") res.statusCode = args[0];
          handleErrorResponse();
          return (origWriteHead as any)(...args);
        };
        const origEnd = res.end.bind(res);
        res.end = (...args: any[]) => {
          handleErrorResponse();
          return (origEnd as any)(...args);
        };
        next();
      });
    },
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, "/");
      if (
        !(
          normalizedId.includes("/@tanstack/start-server-core/src/request-response.ts") ||
          normalizedId.includes("/@tanstack/start-server-core/dist/esm/request-response.js")
        )
      )
        return null;
      const needle = "handler(request, requestOpts)";
      if (!code.includes(needle)) return null;
      return code.replace(
        needle,
        `(globalThis.${HANDLER_RAN_KEY}?.(typeof h3Event === "undefined" ? undefined : h3Event), Promise.resolve(${needle}).catch((err) => { globalThis.${SSR_CAPTURE_KEY}?.(err); throw err; }))`,
      );
    },
  };
}

/** Surfaces server-function errors (thrown inside `createServerFn`) in the dev overlay. */
function devServerFnErrorLogger(): Plugin {
  const HMR_SEND_KEY = "__SERVER_FN_HMR_SEND__";
  return {
    name: "dev-server-fn-error-logger",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      (globalThis as any)[HMR_SEND_KEY] = (data: unknown) => {
        server.ws.send({ type: "custom", event: "server-fn-error", data });
      };
    },
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, "/");
      if (
        !(
          normalizedId.includes("/@tanstack/start-server-core/src/server-functions-handler.ts") ||
          normalizedId.includes("/@tanstack/start-server-core/dist/esm/server-functions-handler.js")
        )
      )
        return null;
      const needle = "const unwrapped = res.result || res.error";
      if (!code.includes(needle)) return null;
      return code.replace(
        needle,
        `${needle}

      if (res?.error) {
        const err = res.error
        const payload = {
          source: 'tanstack',
          type: 'server-fn-error',
          method: request.method,
          url: request.url,
          name: err?.name ?? 'Error',
          message: err?.message ?? String(err),
          stack: typeof err?.stack === 'string' ? err.stack : undefined,
        }
        globalThis.${HMR_SEND_KEY}?.(payload)
      }`,
      );
    },
  };
}

export default defineConfig(async (env) => {
  const { command, mode } = env;

  const plugins: Plugin[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    devServerFnErrorLogger(),
    devSsrErrorLogger(),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    viteReact(),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(
      nitro({
        defaultPreset: "cloudflare-module",
      }) as unknown as Plugin,
    );
  }

  const envDefine: Record<string, string> = {};
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  const isDevBuild = command === "build" && mode === "development";

  const config: UserConfig = {
    define: envDefine,
    ...(isDevBuild
      ? {
          environments: { client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } } },
          esbuild: { keepNames: true },
        }
      : {}),
    css: { transformer: "lightningcss" },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "::",
      port: 8080,
      watch: {
        awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
      },
    },
    plugins,
  };

  return config;
});
