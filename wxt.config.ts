import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "build",
  outDirTemplate: "mangamoinsplus-{{browser}}-mv{{manifestVersion}}",
  manifest: ({ browser }) => ({
    permissions: [
      "downloads",
      "activeTab",
      "scripting",
      // Le document offscreen sert à créer l'URL blob du .cbz (absent de Firefox).
      ...(browser === "firefox" ? [] : ["offscreen"]),
    ],
    host_permissions: ["*://mangamoins.com/*", "*://raijin-scans.fr/*"],
  }),
});
