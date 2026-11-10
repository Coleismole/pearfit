import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built files work at a domain root or under a sub-path such as /app/.
  base: "./",
  define: {
    // npm sets npm_package_version when the build runs through `npm run`.
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
});
