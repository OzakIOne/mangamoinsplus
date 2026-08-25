export default defineBackground({
  main() {
    browser.runtime.onMessage.addListener((message, _sender) => {
      if (message.type === "DOWNLOAD_CHAPTER") {
        return Promise.resolve(
          downloadChapter(message).catch((err) => ({
            downloaded: 0,
            error: String(err?.message ?? err),
          }))
        );
      }
    });
  },
});

type ChapterMessage =
  | {
      site: "mangamoins";
      chapterSlug: string;
      totalPages: number;
      baseUrl: string;
    }
  | {
      site: "raijin";
      mangaSlug: string;
      chapterSlug: string;
      /** Onglet de la page : on y délègue la récupération des images. */
      tabId?: number;
      /** Liste exacte des images extraite de la page (stratégie prioritaire). */
      imageUrls?: string[];
      /** Plan B : URL de référence pour la boucle de sondes. */
      baseUrl?: string;
      pagePadding?: number;
      imageExtension?: string;
    };

interface DownloadResult {
  downloaded: number;
  error?: string;
}

async function downloadChapter(message: ChapterMessage): Promise<DownloadResult> {
  if (message.site === "raijin") {
    return downloadRaijinChapter(message);
  }
  if (message.site === "mangamoins") {
    return downloadMangamoinsChapter(message);
  }
  return { downloaded: 0, error: "Site inconnu" };
}

async function downloadMangamoinsChapter({
  chapterSlug,
  totalPages,
  baseUrl,
}: Extract<ChapterMessage, { site: "mangamoins" }>): Promise<DownloadResult> {
  const downloads = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = String(i).padStart(2, "0");
    downloads.push(
      browser.downloads.download({
        url: `${baseUrl}${page}.webp`,
        filename: `${chapterSlug}/page_${page}.webp`,
        saveAs: false,
      })
    );
  }

  await Promise.all(downloads);
  return { downloaded: downloads.length };
}

async function downloadRaijinChapter({
  mangaSlug,
  chapterSlug,
  baseUrl,
  pagePadding,
  imageExtension,
  imageUrls,
  tabId,
}: Extract<ChapterMessage, { site: "raijin" }>): Promise<DownloadResult> {
  const folder = `${toTitleCase(mangaSlug)}/Chapter ${chapterSlug}`;
  let downloaded = 0;

  // Stratégie principale : la liste exacte des images extraite de la page
  // (ts_reader ou images chargées). On préserve les noms de fichiers d'origine.
  let lastPageNumber = 0;
  if (imageUrls?.length) {
    for (const [index, url] of imageUrls.entries()) {
      const clean = url.split("#")[0];
      const fileName = clean.slice(clean.lastIndexOf("/") + 1).split("?")[0];
      const res = await downloadRaijinImage(tabId, clean, `${folder}/${fileName}`);
      if (!res.ok) {
        return {
          downloaded,
          error:
            `Page ${index + 1}/${imageUrls.length} (${fileName || "sans nom"}) a échoué. ` +
            (res.error ?? "Cause inconnue"),
        };
      }
      const num = Number(fileName.match(/(\d+)/)?.[1] ?? 0);
      if (num > lastPageNumber) lastPageNumber = num;
      downloaded++;
    }

    // Pas d'infos de sonde -> la liste était forcément complète.
    if (!baseUrl || !imageExtension) return { downloaded };
  }

  // Plan B : sondes sur une URL de référence.
  if (!baseUrl || !imageExtension) {
    return { downloaded: 0, error: "Aucune image trouvée sur la page du chapitre" };
  }

  const pad = pagePadding || 3;
  const maxPages = 500; // garde-fou au cas où le site répondrait 200 au-delà de la dernière page

  // Les pages d'un même chapitre peuvent avoir des extensions différentes
  // (ex. 001.png, 002.jpg, 003.png…) : on teste l'extension détectée en premier.
  const extensions = [
    imageExtension,
    ...["png", "jpg", "jpeg", "webp"].map((e) => `.${e}`).filter((e) => e !== imageExtension),
  ];

  // Certains chapitres découpés ne commencent pas à 001 et le lazy-loading
  // peut sauter des numéros : on tolère des trous, avec un plafond d'échecs
  // consécutifs pour détecter la vraie fin du chapitre.
  const maxConsecutiveMisses = 5;
  let consecutiveMisses = 0;

  for (let page = Math.max(1, lastPageNumber + 1); page <= maxPages; page++) {
    const name = String(page).padStart(pad, "0");

    // On cherche la vraie URL de la page parmi les extensions possibles.
    let imageUrl: string | null = null;
    for (const ext of extensions) {
      const candidate = `${baseUrl}${name}${ext}`;
      if (await raijinUrlIsImage(tabId, candidate)) {
        imageUrl = candidate;
        break;
      }
    }

    // Aucune extension ne répond avec une image : soit un trou dans la
    // numérotation, soit la fin du chapitre.
    if (!imageUrl) {
      consecutiveMisses++;
      if (consecutiveMisses >= maxConsecutiveMisses) break;
      continue;
    }
    consecutiveMisses = 0;

    const ext = imageUrl.slice(imageUrl.lastIndexOf("."));
    const res = await downloadRaijinImage(tabId, imageUrl, `${folder}/${name}${ext}`);
    if (!res.ok) {
      return {
        downloaded,
        error: `Page ${page} (${name}${ext}) a échoué. ${res.error ?? "Cause inconnue"}`,
      };
    }
    downloaded++;
  }

  if (downloaded === 0) {
    return { downloaded: 0, error: `Aucun fichier image trouvé sous ${baseUrl}…` };
  }
  return { downloaded };
}

/**
 * Les serveurs de scan bloquent souvent le hotlinking / Cloudflare bloque les
 * requêtes hors session : on demande donc au content script (même origine,
 * vrais cookies + Referer) de récupérer l'image et de nous la renvoyer en
 * data URL, que Chrome peut alors télécharger sans refaire de requête réseau.
 */
async function fetchViaContentScript(
  tabId: number | undefined,
  url: string
): Promise<{ dataUrl: string } | { error: string }> {
  if (tabId === undefined) {
    return { error: "Onglet introuvable (popup fermée ?)" };
  }
  try {
    const res = await browser.tabs.sendMessage(tabId, { type: "FETCH_IMAGE", url });
    if (res?.ok) return { dataUrl: res.dataUrl as string };
    return { error: `Content script: ${res?.error ?? "échec sans détail"}` };
  } catch (err) {
    // sendMessage lève si le content script n'est pas injecté (page rechargée ?)
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Onglet injoignable: ${msg}` };
  }
}

async function downloadRaijinImage(
  tabId: number | undefined,
  url: string,
  filename: string
): Promise<{ ok: boolean; error?: string }> {
  // 1. Data URL via le content script (contourne le blocage hotlink/Cloudflare).
  const fetched = await fetchViaContentScript(tabId, url);
  if ("dataUrl" in fetched) {
    const dl = await downloadAndWait(fetched.dataUrl, filename);
    if (dl.ok) return { ok: true };
    // Le téléchargement de la data URL a échoué : on note pourquoi et on tente le direct.
    console.warn(`[mangamoins+] data URL failed for ${filename}: ${dl.error}`);
  }

  // 2. Repli : téléchargement direct par Chrome (peut être bloqué par le site).
  const direct = await downloadAndWait(url, filename);
  if (direct.ok) return { ok: true };
  return {
    ok: false,
    error: [
      "data URL:" + ("error" in fetched ? ` ${fetched.error}` : " ok mais download KO"),
      `direct: ${direct.error ?? "KO"}`,
    ].join(" | "),
  };
}

async function raijinUrlIsImage(
  tabId: number | undefined,
  url: string
): Promise<boolean> {
  // Via le content script : même session, réponse fiable.
  const probe = await fetchViaContentScript(tabId, url);
  if ("dataUrl" in probe) return true;
  return false;
}

async function downloadAndWait(
  url: string,
  filename: string
): Promise<{ ok: boolean; error?: string }> {
  let downloadId: number;
  try {
    downloadId = await browser.downloads.download({
      url,
      filename,
      saveAs: false,
    });
  } catch (err) {
    // Rejet immédiat de downloads.download() (URL invalide, quota, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  return waitForDownload(downloadId);
}

function describeDownloadItem(item: Browser.downloads.DownloadItem | undefined): string {
  if (!item) return "entrée de téléchargement introuvable";
  return `state=${item.state}, mime=${item.mime ?? "?"}, bytesReceived=${item.bytesReceived}, error=${
    item.error ?? "-"
  }`;
}

async function waitForDownload(
  downloadId: number
): Promise<{ ok: boolean; error?: string }> {
  // Vérifie d'abord si le téléchargement est déjà terminé (cas des fichiers très rapides)
  const [initial] = await browser.downloads.search({ id: downloadId });
  if (initial?.state === "complete") {
    return isImageDownload(initial, downloadId);
  }
  if (initial?.state === "interrupted" || initial?.error) {
    return {
      ok: false,
      error: `interrompu avant démarrage — ${describeDownloadItem(initial)}`,
    };
  }

  return new Promise((resolve) => {
    let settled = false;

    function finish(result: { ok: boolean; error?: string }) {
      if (settled) return;
      settled = true;
      browser.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    }

    async function checkNow() {
      // Rattrape un téléchargement qui s'est terminé entre le search initial et l'écoute
      const [item] = await browser.downloads.search({ id: downloadId });
      if (!item) return;
      if (item.state === "complete") {
        finish(await isImageDownload(item, downloadId));
      } else if (item.state === "interrupted" || item.error) {
        finish({ ok: false, error: `interrompu — ${describeDownloadItem(item)}` });
      }
    }

    function onChanged(delta: Browser.downloads.DownloadDelta) {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;

      if (state === "complete") {
        browser.downloads.search({ id: downloadId }).then(async ([done]) =>
          finish(await isImageDownload(done, downloadId))
        );
      } else if (state === "interrupted" || delta.error?.current) {
        void browser.downloads.search({ id: downloadId }).then(([item]) =>
          finish({ ok: false, error: `interrompu — ${describeDownloadItem(item)}` })
        );
      }
    }

    browser.downloads.onChanged.addListener(onChanged);
    void checkNow();
  });
}

async function isImageDownload(
  item: Browser.downloads.DownloadItem | undefined,
  downloadId: number
): Promise<{ ok: boolean; error?: string }> {
  // Certains sites renvoient une page 404 avec un statut 200 ; on supprime alors l'entrée
  if (!item) return { ok: false, error: "entrée de téléchargement introuvable" };
  if (item.mime && !item.mime.startsWith("image/")) {
    await browser.downloads.erase({ id: downloadId }).catch(() => []);
    return { ok: false, error: `le serveur n'a pas renvoyé une image (mime=${item.mime})` };
  }
  return { ok: true };
}

function toTitleCase(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
