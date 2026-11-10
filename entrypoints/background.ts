import {
  bytesToBase64,
  dataUrlToBytes,
  imageExtension,
  imageMime,
  looksLikeImage,
  type Bytes,
} from "@/lib/binary";
import {
  isDownloadRequest,
  type ChapterInfo,
  type DownloadProgress,
  type DownloadRequest,
  type DownloadResult,
  type FetchImageRequest,
  type FetchImageResponse,
  type RevokeBlobUrlRequest,
} from "@/lib/messages";
import { createZip, type ZipFile } from "@/lib/zip";

const MAX_PAGES = 500;
const MAX_CONSECUTIVE_MISSES = 5;
const MAX_FAILURE_DETAILS = 5;
const CBZ_MIME = "application/vnd.comicbook+zip";
const PAGE_NUMBER_WIDTH = 4;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

interface PlannedPage {
  url: string;
  name: string;
}

interface ProbeInfo {
  baseUrl: string;
  extension: string;
  padding: number;
  startPage: number;
}

interface ChapterPlan {
  folder: string;
  pages: PlannedPage[];
  probe?: ProbeInfo;
  preferDirect: boolean;
}

interface PageChunk extends PlannedPage {
  bytes?: Bytes;
}

interface DownloadTarget {
  url: string;
  filename: string;
  expectImage: boolean;
}

let lastFetchFailure: string | undefined;
let failureLog: string[] = [];

interface OffscreenDocument {
  ensure: () => Promise<void>;
  reset: () => void;
}

export default defineBackground({
  main() {
    void ensureCdnHeaderRule();
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isDownloadRequest(message)) return undefined;
      return downloadChapter(message)
        .catch((error) => ({ downloaded: 0, error: describeError(error) }))
        .then((result) => withDiagnostics(result));
    });
  },
});

const withDiagnostics = (result: DownloadResult): DownloadResult => ({
  ...result,
  build: __BUILD_TIME__,
  dnr: dnrRuleCount,
  ...(failureLog.length > 0 ? { details: [...failureLog] } : {}),
});

const CDN_HEADER_RULE_ID = 1;
let dnrRuleCount: number | undefined;

// Le CDN d'images est protégé contre le hotlink : une requête cross-site (celle
// du service worker, origine `chrome-extension://`) est refusée, alors que la
// page du site y accède (same-site). On retire l'origine de la requête et on
// ajoute les en-têtes CORS sur la réponse, pour que le content script — qui
// parle depuis la page — puisse lire les octets.
const ensureCdnHeaderRule = async (): Promise<void> => {
  const rules = browser.declarativeNetRequest;
  if (!rules) return;
  const rule: Browser.declarativeNetRequest.Rule = {
    id: CDN_HEADER_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "origin", operation: "remove" },
        { header: "referer", operation: "set", value: "https://mangamoins.com/" },
      ],
      responseHeaders: [
        { header: "access-control-allow-origin", operation: "set", value: "https://mangamoins.com" },
        { header: "access-control-allow-credentials", operation: "set", value: "true" },
        { header: "cross-origin-resource-policy", operation: "remove" },
      ],
    },
    condition: {
      urlFilter: "||mangamoinsscans.mangamoins.com/",
      resourceTypes: ["xmlhttprequest", "other"],
    },
  };
  await rules
    .updateDynamicRules({ removeRuleIds: [CDN_HEADER_RULE_ID], addRules: [rule] })
    .catch(() => undefined);
  dnrRuleCount = (await rules.getDynamicRules().catch(() => [])).length;
};

async function downloadChapter({ format, tabId, chapter }: DownloadRequest): Promise<DownloadResult> {
  lastFetchFailure = undefined;
  failureLog = [];
  const plan = planChapter(chapter);
  if (plan.pages.length === 0 && !plan.probe) {
    return { downloaded: 0, error: "Aucune image trouvée sur la page du chapitre" };
  }
  return format === "cbz" ? downloadAsCbz({ tabId, plan }) : downloadAsImages({ tabId, plan });
}

function planChapter(chapter: ChapterInfo): ChapterPlan {
  return chapter.site === "mangamoins" ? planMangamoins(chapter) : planRaijin(chapter);
}

function planMangamoins({ chapterSlug, totalPages, baseUrl, firstPage, pagePadding, imageExtension }: Extract<ChapterInfo, { site: "mangamoins" }>): ChapterPlan {
  const padding = pagePadding && pagePadding > 0 ? pagePadding : Math.max(2, String(totalPages).length);
  const extension = imageExtension ?? ".webp";
  const start = firstPage && firstPage > 0 ? firstPage : 1;
  const pages = Array.from({ length: totalPages }, (_, index) => {
    const number = String(start + index).padStart(padding, "0");
    return { url: `${baseUrl}${number}${extension}`, name: `page_${number}${extension}` };
  });
  return { folder: chapterSlug, pages, preferDirect: true };
}

function planRaijin({ mangaSlug, chapterSlug, imageUrls, baseUrl, pagePadding, imageExtension }: Extract<ChapterInfo, { site: "raijin" }>): ChapterPlan {
  const pages = (imageUrls ?? []).map((raw) => {
    const url = raw.split("#")[0];
    return { url, name: fileName(url) };
  });

  const lastPage = pages.reduce((highest, page) => Math.max(highest, pageNumber(page.url)), 0);
  const probe =
    baseUrl && imageExtension
      ? {
          baseUrl,
          extension: imageExtension,
          padding: pagePadding || 3,
          startPage: Math.max(1, lastPage + 1),
        }
      : undefined;

  return {
    folder: `${toTitleCase(mangaSlug)}/Chapter ${chapterSlug}`,
    pages,
    ...(probe ? { probe } : {}),
    preferDirect: false,
  };
}

async function downloadAsCbz({ tabId, plan }: { tabId: number | undefined; plan: ChapterPlan }): Promise<DownloadResult> {
  const files: ZipFile[] = [];
  let skipped = 0;
  let consecutiveMisses = 0;

  for await (const page of chapterPages({ tabId, plan })) {
    const bytes =
      page.bytes ?? (await fetchImageBytes({ tabId, url: page.url, attempts: 2 }));
    // Le compteur du lecteur peut annoncer plus de pages que le CDN n'en sert
    // (pages publicitaires intercalées) : une page absente est sautée, pas fatale.
    if (!bytes) {
      skipped++;
      consecutiveMisses++;
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) break;
      continue;
    }
    consecutiveMisses = 0;
    files.push({
      name: zipEntryName({ index: files.length + 1, extension: imageExtension({ url: page.url, bytes }) }),
      bytes,
    });
    void reportProgress({ done: files.length + skipped, total: plan.pages.length });
  }

  if (files.length === 0) {
    return { downloaded: 0, error: `Aucune page récupérable pour ce chapitre.${failureDetail()}` };
  }

  const filename = `${plan.folder}.cbz`;
  const delivery = await deliverFile({ bytes: createZip({ files }), filename, mime: CBZ_MIME });
  if (!delivery.ok) return { downloaded: files.length, error: delivery.error };
  return { downloaded: files.length, file: filename, ...(skipped > 0 ? { skipped } : {}) };
}

async function downloadAsImages({ tabId, plan }: { tabId: number | undefined; plan: ChapterPlan }): Promise<DownloadResult> {
  let downloaded = 0;
  let skipped = 0;
  let consecutiveMisses = 0;

  for await (const page of chapterPages({ tabId, plan })) {
    const filename = `${plan.folder}/${page.name}`;
    const preloaded =
      page.bytes ?? (plan.preferDirect ? undefined : await fetchImageBytes({ tabId, url: page.url, attempts: 2 }));
    const saved = await savePage({ tabId, plan, page, filename, preloaded });
    if (!saved.ok) {
      skipped++;
      consecutiveMisses++;
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        return {
          downloaded,
          skipped,
          error: `Page ${page.name} : ${saved.error ?? "échec inconnu"}`,
        };
      }
      continue;
    }
    consecutiveMisses = 0;
    downloaded++;
    void reportProgress({ done: downloaded + skipped, total: plan.pages.length });
  }

  if (downloaded === 0) {
    return { downloaded: 0, error: `Aucune page récupérable pour ce chapitre.${failureDetail()}` };
  }
  return { downloaded, ...(skipped > 0 ? { skipped } : {}) };
}

async function savePage({
  tabId,
  plan,
  page,
  filename,
  preloaded,
}: {
  tabId: number | undefined;
  plan: ChapterPlan;
  page: PageChunk;
  filename: string;
  preloaded: Bytes | undefined;
}): Promise<{ ok: boolean; error?: string }> {
  if (plan.preferDirect) {
    const direct = await downloadAndWait({ url: page.url, filename, expectImage: true });
    if (direct.ok) return direct;
  }

  const bytes =
    preloaded ?? (await fetchImageBytes({ tabId, url: page.url, attempts: 2 }));
  if (!bytes) return { ok: false, error: "récupération impossible (session ou protection anti-hotlink)" };

  const dataUrl = `data:${imageMime(imageExtension({ url: page.url, bytes }))};base64,${bytesToBase64(bytes)}`;
  return downloadAndWait({ url: dataUrl, filename, expectImage: true });
}

async function* chapterPages({
  tabId,
  plan,
}: {
  tabId: number | undefined;
  plan: ChapterPlan;
}): AsyncGenerator<PageChunk> {
  for (const page of plan.pages) yield page;

  const probe = plan.probe;
  if (!probe) return;

  const extensions = [probe.extension, ...IMAGE_EXTENSIONS.filter((ext) => ext !== probe.extension)];
  let consecutiveMisses = 0;

  for (let page = probe.startPage; page <= MAX_PAGES; page++) {
    const number = String(page).padStart(probe.padding, "0");
    const found = await probePage({ tabId, probe, number, extensions });
    if (!found) {
      consecutiveMisses++;
      if (consecutiveMisses >= MAX_CONSECUTIVE_MISSES) return;
      continue;
    }
    consecutiveMisses = 0;
    yield found;
  }
}

async function probePage({
  tabId,
  probe,
  number,
  extensions,
}: {
  tabId: number | undefined;
  probe: ProbeInfo;
  number: string;
  extensions: string[];
}): Promise<PageChunk | undefined> {
  for (const extension of extensions) {
    const url = `${probe.baseUrl}${number}${extension}`;
    const bytes = await fetchImageBytes({ tabId, url });
    if (bytes) return { url, name: `${number}${extension}`, bytes };
  }
  return undefined;
}

async function fetchImageBytes({
  tabId,
  url,
  attempts = 1,
}: {
  tabId: number | undefined;
  url: string;
  attempts?: number;
}): Promise<Bytes | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const bytes = await fetchImageOnce({ tabId, url });
    if (bytes) return bytes;
  }
  return undefined;
}

async function fetchImageOnce({
  tabId,
  url,
}: {
  tabId: number | undefined;
  url: string;
}): Promise<Bytes | undefined> {
  // La page est le seul contexte autorisé par la protection anti-hotlink du CDN :
  // on passe par le content script, puis on tente le service worker en secours.
  const fromPage = await fetchViaContentScript({ tabId, url });
  if ("dataUrl" in fromPage) {
    const bytes = dataUrlToBytes(fromPage.dataUrl);
    if (looksLikeImage(bytes)) return bytes;
  }
  return fetchImageDirectly(url);
}

async function fetchImageDirectly(url: string): Promise<Bytes | undefined> {
  try {
    const response = await fetch(url, { credentials: "include" });
    const contentType = response.headers.get("content-type") ?? "sans content-type";
    if (!response.ok) {
      noteFailure(`${url} → HTTP ${response.status} (${contentType})`);
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!looksLikeImage(bytes)) {
      noteFailure(`${url} → ${contentType}, ${bytes.length} octets non reconnus comme image`);
      return undefined;
    }
    return bytes;
  } catch (error) {
    noteFailure(`${url} → ${describeError(error)}`);
    return undefined;
  }
}

async function fetchViaContentScript({
  tabId,
  url,
}: {
  tabId: number | undefined;
  url: string;
}): Promise<{ dataUrl: string } | { error: string }> {
  if (tabId === undefined) return { error: "onglet introuvable (popup fermée ?)" };
  const request: FetchImageRequest = { type: "FETCH_IMAGE", url };
  try {
    const response: FetchImageResponse | undefined = await browser.tabs.sendMessage(tabId, request);
    if (response?.ok && response.dataUrl) return { dataUrl: response.dataUrl };
    const error = `content script: ${response?.error ?? "échec sans détail"}`;
    noteFailure(`${url} → ${error}`);
    return { error };
  } catch (error) {
    const description = `onglet injoignable: ${describeError(error)}`;
    noteFailure(`${url} → ${description}`);
    return { error: description };
  }
}

async function reportProgress({ done, total }: { done: number; total: number }): Promise<void> {
  const progress: DownloadProgress = { type: "DOWNLOAD_PROGRESS", done, total };
  await browser.runtime.sendMessage(progress).catch(() => undefined);
}

async function deliverFile({
  bytes,
  filename,
  mime,
}: {
  bytes: Bytes;
  filename: string;
  mime: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      return await downloadAndWait({ url, filename, expectImage: false });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return deliverFileThroughOffscreen({ bytes, filename, mime });
}

const offscreenDocument: OffscreenDocument = {
  async ensure() {
    const offscreen = browser.offscreen;
    if (!offscreen) throw new Error("API offscreen indisponible dans ce navigateur");
    if (await offscreen.hasDocument()) return;
    await offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Assembler le fichier CBZ en mémoire et créer son URL blob pour le téléchargement.",
    });
  },
  reset() {
    void browser.offscreen?.closeDocument().catch(() => undefined);
  },
};

async function withOffscreenDocument<T>(run: () => Promise<T>): Promise<T> {
  try {
    await offscreenDocument.ensure();
    return await run();
  } finally {
    offscreenDocument.reset();
  }
}

async function deliverFileThroughOffscreen({
  bytes,
  filename,
  mime,
}: {
  bytes: Bytes;
  filename: string;
  mime: string;
}): Promise<{ ok: boolean; error?: string }> {
  return withOffscreenDocument(async () => {
    let response: unknown;
    try {
      response = await browser.runtime.sendMessage({
        type: "CREATE_BLOB_URL",
        base64: bytesToBase64(bytes),
        mime,
      });
    } catch (error) {
      return {
        ok: false,
        error: `transmission du fichier au document offscreen impossible (${describeError(error)}). Réessaie en mode « images séparées ».`,
      };
    }

    const blobUrl = readBlobUrl(response);
    if (!blobUrl) return { ok: false, error: "le document offscreen n'a pas pu assembler le fichier" };

    try {
      return await downloadAndWait({ url: blobUrl, filename, expectImage: false });
    } finally {
      const revoke: RevokeBlobUrlRequest = { type: "REVOKE_BLOB_URL", url: blobUrl };
      await browser.runtime.sendMessage(revoke).catch(() => undefined);
    }
  });
}

const readBlobUrl = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("url" in value)) return undefined;
  const url: unknown = Reflect.get(value, "url");
  return typeof url === "string" ? url : undefined;
};

async function downloadAndWait(target: DownloadTarget): Promise<{ ok: boolean; error?: string }> {
  let downloadId: number;
  try {
    downloadId = await browser.downloads.download({
      url: target.url,
      filename: target.filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
  return waitForDownload(downloadId, target);
}

async function waitForDownload(
  downloadId: number,
  target: DownloadTarget,
): Promise<{ ok: boolean; error?: string }> {
  const [initial] = await browser.downloads.search({ id: downloadId });
  if (initial?.state === "complete") return verifyDownload(initial, downloadId, target);
  if (initial?.state === "interrupted" || initial?.error) {
    return { ok: false, error: `interrompu avant démarrage — ${describeDownloadItem(initial)}` };
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
      const [item] = await browser.downloads.search({ id: downloadId });
      if (!item) return;
      if (item.state === "complete") {
        finish(await verifyDownload(item, downloadId, target));
      } else if (item.state === "interrupted" || item.error) {
        finish({ ok: false, error: `interrompu — ${describeDownloadItem(item)}` });
      }
    }

    function onChanged(delta: Browser.downloads.DownloadDelta) {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;

      if (state === "complete") {
        void browser.downloads
          .search({ id: downloadId })
          .then(([item]) => verifyDownload(item, downloadId, target))
          .then(finish);
      } else if (state === "interrupted" || delta.error?.current) {
        void browser.downloads
          .search({ id: downloadId })
          .then(([item]) =>
            finish({ ok: false, error: `interrompu — ${describeDownloadItem(item)}` }),
          );
      }
    }

    browser.downloads.onChanged.addListener(onChanged);
    void checkNow();
  });
}

async function verifyDownload(
  item: Browser.downloads.DownloadItem | undefined,
  downloadId: number,
  target: DownloadTarget,
): Promise<{ ok: boolean; error?: string }> {
  if (!item) return { ok: false, error: "entrée de téléchargement introuvable" };
  if (target.expectImage && item.mime && !item.mime.startsWith("image/")) {
    await browser.downloads.erase({ id: downloadId }).catch(() => []);
    return { ok: false, error: `le serveur n'a pas renvoyé une image (mime=${item.mime})` };
  }
  return { ok: true };
}

const describeDownloadItem = (item: Browser.downloads.DownloadItem | undefined): string => {
  if (!item) return "entrée de téléchargement introuvable";
  return `state=${item.state}, mime=${item.mime ?? "?"}, bytesReceived=${item.bytesReceived}, error=${
    item.error ?? "-"
  }`;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failureDetail = (): string =>
  lastFetchFailure ? ` Dernier essai : ${lastFetchFailure}` : "";

const noteFailure = (message: string): void => {
  lastFetchFailure = message;
  if (failureLog.length < MAX_FAILURE_DETAILS) failureLog.push(message);
};

const zipEntryName = ({ index, extension }: { index: number; extension: string }): string =>
  `${String(index).padStart(PAGE_NUMBER_WIDTH, "0")}${extension}`;

const fileName = (url: string): string => {
  const clean = url.split("?")[0];
  return clean.slice(clean.lastIndexOf("/") + 1);
};

const pageNumber = (url: string): number => {
  const match = url.match(/(\d+)\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i);
  return match ? Number(match[1]) : 0;
};

function toTitleCase(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
