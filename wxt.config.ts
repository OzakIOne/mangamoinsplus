import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "build",
  outDirTemplate: "mangamoinsplus-{{browser}}-mv{{manifestVersion}}",
  vite: () => ({
    // Horodatage injecté au build : permet de vérifier dans le popup
    // quelle version du code le navigateur exécute réellement.
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  }),
  manifest: ({ browser }) => ({
    name: "Manga Downloader",
    description: "Télécharge les chapitres MangaMoins et Raijin Scans en .cbz ou en images.",
    action: { default_title: "Manga Downloader" },
    permissions: [
      "downloads",
      "activeTab",
      "scripting",
      // Cloudflare du CDN d'images refuse les requêtes portant une origine
      // `chrome-extension://` : DNR réécrit ces en-têtes avant l'envoi.
      ...(browser === "firefox"
        ? []
        : ["offscreen", "declarativeNetRequestWithHostAccess"]),
    ],
    // Les pages sont servies depuis un sous-domaine dédié (mangamoinsscans.mangamoins.com)
    // qui ne renvoie aucun en-tête CORS : sans cette permission, le service worker
    // ne peut pas lire les octets des images.
    host_permissions: ["*://*.mangamoins.com/*", "*://raijin-scans.fr/*"],
  }),
});
