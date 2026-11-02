import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ["browser", "import", "module", "default"],
  },
  server: {
    cors: {
      origin: "*",
    },
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
  preview: {
    cors: {
      origin: "*",
    },
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        McpAuthorization: fileURLToPath(new URL("./McpAuthorization.html", import.meta.url)),
      },
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "lucide-react"],
          engine: ["@tinytldr/core", "@tinytldr/runtime"],
          catalog: ["@tinytldr/templates"],
          auth: ["firebase/app", "firebase/auth"],
          sanitizer: ["dompurify"],
        },
      },
    },
  },
});
