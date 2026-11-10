import { bytesToBase64, imageMime, sniffImageExtension } from "@/lib/binary";
import type { ChapterInfo, FetchImageRequest, FetchImageResponse } from "@/lib/messages";

export default defineContentScript({
  matches: ["*://mangamoins.com/*", "*://raijin-scans.fr/*"],
  main() {
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isMessage(message)) return undefined;
      if (message.type === "GET_CHAPTER_INFO") {
        const data = getChapterInfo();
        sendResponse(data);
        return true;
      }
      // Le background ne peut pas toujours télécharger les images directement
      // (hotlinking bloqué par Cloudflare) : on les récupère ici, dans la
      // session de la page, et on les renvoie en data URL.
      if (message.type === "FETCH_IMAGE") {
        fetchAsDataURL(message.url)
          .then((dataUrl) => sendResponse({ ok: true, dataUrl } satisfies FetchImageResponse))
          .catch((error) =>
            sendResponse({ ok: false, error: String(error?.message ?? error) } satisfies FetchImageResponse),
          );
        return true;
      }
      return undefined;
    });
  },
});

const isMessage = (
  message: unknown,
): message is { type: "GET_CHAPTER_INFO" } | FetchImageRequest => {
  if (typeof message !== "object" || message === null) return false;
  return "type" in message && typeof Reflect.get(message, "type") === "string";
};

function getChapterInfo(): ChapterInfo | null {
  const url = window.location.href;
  if (/mangamoins\.com/.test(url)) return getMangamoinsInfo();
  if (/raijin-scans\.fr/.test(url)) return getRaijinInfo(url);
  return null;
}

async function fetchAsDataURL(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const extension = sniffImageExtension(bytes);
  if (!extension) {
    throw new Error(`pas une image (${res.headers.get("content-type") ?? "type inconnu"})`);
  }
  return `data:${imageMime(extension)};base64,${bytesToBase64(bytes)}`;
}

function getMangamoinsInfo(): ChapterInfo | null {
  const url = window.location.href;
  const match = url.match(/\/scan\/([^/?#]+)/);
  if (!match) return null;
  const chapterSlug = match[1];
  const totalPages = Number(document.getElementById("readerTotalPages")?.textContent);
  if (!Number.isFinite(totalPages) || totalPages < 1) return null;

  const source = findMangamoinsPageSource();
  if (!source) return null;

  return {
    site: "mangamoins",
    chapterSlug,
    totalPages,
    baseUrl: source.baseUrl,
    firstPage: source.firstPage,
    pagePadding: source.pagePadding,
    imageExtension: source.imageExtension,
  };
}

/**
 * Les pages vivent sur un CDN dédié, sous la forme `<base>/<hash>/01.webp`.
 * On lit la largeur réelle et le numéro de la page affichée plutôt que de les
 * déduire du nombre total de pages : le compteur du lecteur inclut les pages
 * publicitaires intercalées, pas le CDN.
 */
function findMangamoinsPageSource():
  | { baseUrl: string; firstPage: number; pagePadding: number; imageExtension: string }
  | null {
  const readers = document.querySelectorAll<HTMLImageElement>(
    "img.reader-manga-page, .reader-image-wrapper img, img[src*='.webp']",
  );
  const numbered = /^(.*\/)(\d+)\.(webp|png|jpe?g|gif|avif)(?:[?#].*)?$/i;

  for (const image of readers) {
    const candidate = image.currentSrc || image.src;
    const match = candidate.match(numbered);
    if (!match) continue;
    return {
      baseUrl: match[1],
      firstPage: Number(match[2]),
      pagePadding: match[2].length,
      imageExtension: `.${match[3].toLowerCase()}`,
    };
  }
  return null;
}

function getRaijinInfo(url: string): ChapterInfo | null {
  // Le slug du chapitre peut contenir un suffixe pour les chapitres découpés :
  // 345, 346-1, 346-2…
  const match = url.match(/\/manga\/([^/?#]+)\/([^/?#]+)\/?/);
  if (!match) return null;
  const [, mangaSlug, chapterSlug] = match;

  const candidates = collectRaijinCandidates();

  // Stratégies par ordre de préférence :
  // 1. La liste canonique embarquée par le lecteur (ts_reader chez Madara) :
  //    toutes les pages, y compris celles pas encore chargées par le lazy-loading.
  // 2. Les images déjà présentes/chargées sur la page.
  // 3. Une URL de référence + boucle de sondes côté background.
  const readerImages = extractTsReaderImages(chapterSlug);
  const pageImages = collectNumberedImages(candidates);

  let imageUrls: string[] | undefined;
  if (readerImages.length >= 1) imageUrls = readerImages;
  else if (pageImages.length >= 1) imageUrls = pageImages;

  // Les chapitres découpés (346-1, 346-2…) peuvent commencer à un numéro != 1
  // et le lazy-loading peut cacher des pages : on fournit aussi les infos de
  // sonde pour que le background prolonge la liste au-delà des images vues.
  const probeInfo = pickProbeInfo(candidates);
  if (!imageUrls && !probeInfo) return null;

  return {
    site: "raijin",
    mangaSlug,
    chapterSlug,
    ...(imageUrls ? { imageUrls } : {}),
    ...probeInfo,
  };
}

/** Rassemble toutes les URLs d'images repérables sur la page. */
function collectRaijinCandidates() {
  const candidates = new Set<string>();

  // 1. Ressources déjà chargées par la page — fonctionne même avec des <img> en blob:
  for (const entry of performance.getEntriesByType("resource")) {
    candidates.add(entry.name);
  }

  // 2. Attributs des <img> (le lazy-loading garde souvent la vraie URL dans data-src)
  for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
    for (const attr of [
      img.src,
      img.dataset.src,
      img.dataset.lazySrc,
      img.getAttribute("data-src"),
    ]) {
      if (attr) candidates.add(attr);
    }
  }

  // 3. HTML brut + scripts inline
  const html = document.documentElement.outerHTML;
  const absolute =
    /https?:\/\/[^"'\s]+?\/wp-content\/uploads\/WP-manga\/data\/[^"'\s]+?\.(png|jpe?g|webp)/gi;
  for (const m of html.matchAll(absolute)) candidates.add(m[0]);

  const relative =
    /\/wp-content\/uploads\/WP-manga\/data\/[^"'\s]+?\.(png|jpe?g|webp)/gi;
  for (const m of html.matchAll(relative)) {
    candidates.add(new URL(m[0], window.location.origin).href);
  }

  return candidates;
}

/**
 * Madara embarque la liste complète des images du chapitre dans un script
 * `ts_reader.run({"sources":[{"slug":"…","images":["…"]}]})`.
 */
function extractTsReaderImages(chapterSlug: string): string[] {
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent ?? "";
    const marker = text.indexOf("ts_reader.run(");
    if (marker === -1) continue;
    const braceStart = text.indexOf("{", marker);
    if (braceStart === -1) continue;

    const json = extractJsonObject(text, braceStart);
    if (!json) continue;

    let parsed: { sources?: Array<{ slug?: string; images?: string[] }> };
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }

    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    // Plusieurs « sources » (miroirs) peuvent exister : on préfère celle du chapitre courant.
    const ordered = [
      ...sources.filter((s) => s.slug === chapterSlug),
      ...sources,
    ];
    for (const source of ordered) {
      const images = (source.images ?? [])
        .filter((u): u is string => typeof u === "string" && u.length > 0)
        .filter((u) => !/thumb/i.test(u))
        .map((u) => new URL(u, window.location.href).href);
      if (images.length > 0) return [...new Set(images)];
    }
  }
  return [];
}

/** Extrait l'objet JSON équilibré commençant à `start` (index d'une accolade ouvrante). */
function extractJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Toutes les images numérotées du dossier data, triées par numéro de page. */
function collectNumberedImages(candidates: Set<string>): string[] {
  const pattern =
    /\/wp-content\/uploads\/WP-manga\/data\/\d+\.(?:png|jpe?g|webp)(?:[?#].*)?$/i;
  const urls = new Set<string>();
  for (const candidate of candidates) {
    if (!pattern.test(candidate)) continue;
    if (/thumb/i.test(candidate)) continue;
    urls.add(candidate.split("#")[0]);
  }
  return [...urls].sort((a, b) => pageNumber(a) - pageNumber(b));
}

function pageNumber(url: string): number {
  const match = url.match(/(\d+)\.(?:png|jpe?g|webp)(?:[?#].*)?$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Plan B : dériver une URL de référence pour la boucle de sondes du background. */
function pickProbeInfo(candidates: Set<string>) {
  const imagePattern = /(.*\/)(\d+)\.(png|jpe?g|webp)$/i;
  const sortedCandidates = [...candidates].sort((a, b) => score(b) - score(a));
  for (const candidate of sortedCandidates) {
    const match = candidate.match(imagePattern);
    if (!match) continue;
    return {
      baseUrl: match[1],
      pagePadding: match[2].length, // 3 ici : 001, 002, …
      imageExtension: `.${match[3].toLowerCase()}`,
    };
  }
  return null;
}

function score(url: string) {
  let s = 0;
  if (/\/wp-content\/uploads\/WP-manga\/data\//i.test(url)) s += 4;
  if (/thumb/i.test(url)) s -= 4;
  if (/blob:/.test(url)) s -= 10;
  return s;
}
