import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "build",
  outDirTemplate: "mangamoinsplus-{{browser}}-mv{{manifestVersion}}",
  manifest: {
    permissions: ["downloads", "activeTab", "scripting"],
    host_permissions: ["*://mangamoins.com/*"],
  },
});
