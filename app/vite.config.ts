import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths by default, so the built files work at a domain root or under any sub-path.
  // The hosted build (scripts/assemble-site.mjs) sets APP_BASE=/app/ for absolute /app/ asset paths: that is what
  // lets /app and /app/<anything> be answered with index.html without breaking the asset URLs.
  base: process.env.APP_BASE || "./",
  define: {
    // npm sets npm_package_version when the build runs through `npm run`.
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "dev"),
  },
});
