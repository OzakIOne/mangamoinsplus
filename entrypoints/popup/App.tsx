import { useEffect, useState } from "react";
import {
  isChapterInfo,
  isDownloadProgress,
  readDownloadResult,
  type ChapterInfo,
  type OutputFormat,
} from "@/lib/messages";

const STATUS_LABELS = {
  idle: "⬇️ Télécharger le chapitre",
  loading: "Téléchargement…",
  done: "⬇️ Télécharger le chapitre",
  error: "⬇️ Réessayer",
} as const;

export default function App() {
  const [status, setStatus] = useState<keyof typeof STATUS_LABELS>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [format, setFormat] = useState<OutputFormat>("cbz");
  const [chapter, setChapter] = useState<ChapterInfo | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [workerBuild, setWorkerBuild] = useState<string | null>(null);
  const [dnrRules, setDnrRules] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    void detectChapter();
  }, []);

  useEffect(() => {
    const listener = (candidate: unknown) => {
      if (!isDownloadProgress(candidate)) return undefined;
      setProgress({ done: candidate.done, total: candidate.total });
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  async function detectChapter() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const info: unknown = await browser.tabs.sendMessage(tab.id, { type: "GET_CHAPTER_INFO" });
    if (!isChapterInfo(info)) {
      setStatus("error");
      setMessage("Ouvre une page de chapitre MangaMoins ou Raijin Scans.");
      return;
    }
    setChapter(info);
  }

  async function handleDownload() {
    if (!chapter) return;
    setStatus("loading");
    setProgress(null);
    setDetails([]);
    setMessage("Préparation…");

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const response: unknown = await browser.runtime
      .sendMessage({ type: "DOWNLOAD_CHAPTER", format, tabId: tab?.id, chapter })
      .catch((error) => ({ downloaded: 0, error: String(error) }));

    const result = readDownloadResult(response);
    if (!result) {
      setStatus("error");
      setMessage("Réponse inattendue du service worker.");
      return;
    }
    setDetails(result.details ?? []);
    setWorkerBuild(result.build ?? null);
    setDnrRules(result.dnr ?? null);
    if (result.error) {
      setStatus("error");
      setMessage(`❌ ${result.downloaded} page(s) avant échec — ${result.error}`);
      return;
    }
    if (result.downloaded === 0) {
      setStatus("error");
      setMessage("Aucune page téléchargée. Recharge la page du chapitre et réessaie.");
      return;
    }
    setStatus("done");
    const skippedNote = result.skipped
      ? ` · ${result.skipped} page(s) absente(s) du site, ignorée(s)`
      : "";
    setMessage(
      result.file
        ? `✅ ${result.downloaded} pages → ${result.file}${skippedNote}`
        : `✅ ${result.downloaded} page${result.downloaded > 1 ? "s" : ""} téléchargée${result.downloaded > 1 ? "s" : ""}${skippedNote}`,
    );
  }

  const pageCount = chapter?.site === "raijin" ? chapter.imageUrls?.length : chapter?.totalPages;

  return (
    <div style={{ width: 300, padding: 16, fontFamily: "sans-serif" }}>
      <h2>🎨 Manga Downloader</h2>

      {chapter ? (
        <>
          {chapter.site === "raijin" && (
            <p>
              📚 <strong>{toTitleCase(chapter.mangaSlug)}</strong>
            </p>
          )}
          <p>
            📄 Chapter: <strong>{chapter.chapterSlug}</strong>
            {pageCount ? ` · ${pageCount} pages` : ""}
          </p>

          <label
            style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 10 }}
          >
            <input
              type="checkbox"
              checked={format === "cbz"}
              disabled={status === "loading"}
              onChange={(event) => setFormat(event.target.checked ? "cbz" : "images")}
            />
            Regrouper en un fichier .cbz
          </label>

          <button
            onClick={handleDownload}
            disabled={status === "loading"}
            style={{ width: "100%", padding: 8, cursor: "pointer" }}
          >
            {STATUS_LABELS[status]}
          </button>
        </>
      ) : (
        <p>Ouvre d'abord une page de chapitre.</p>
      )}

      {status === "loading" && progress && (
        <p style={{ marginTop: 8, fontSize: 12 }}>
          {progress.total > progress.done
            ? `${progress.done}/${progress.total} pages…`
            : `${progress.done} page(s)…`}
        </p>
      )}
      {message && status !== "loading" && <p style={{ marginTop: 8, fontSize: 12 }}>{message}</p>}

      {details.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 10, wordBreak: "break-all" }}>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}

      <button
        onClick={() => setShowDebug((visible) => !visible)}
        style={{ marginTop: 10, fontSize: 10, background: "none", border: "none", color: "#666", cursor: "pointer", padding: 0 }}
      >
        {showDebug ? "masquer le debug" : "debug"}
      </button>

      {showDebug && (
        <pre
          style={{
            margin: "6px 0 0",
            padding: 8,
            background: "#f4f4f4",
            borderRadius: 4,
            fontSize: 10,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {debugReport({ chapter, workerBuild, details, dnrRules })}
        </pre>
      )}
    </div>
  );
}

const debugReport = ({
  chapter,
  workerBuild,
  details,
  dnrRules,
}: {
  chapter: ChapterInfo | null;
  workerBuild: string | null;
  details: string[];
  dnrRules: number | null;
}): string => {
  const manifest = browser.runtime.getManifest();
  return [
    `extension  ${manifest.version}`,
    `popup      ${__BUILD_TIME__}`,
    `worker     ${workerBuild ?? "inconnu (aucun téléchargement lancé)"}`,
    `règles DNR ${dnrRules ?? "inconnu"}`,
    `hôtes      ${(manifest.host_permissions ?? []).join(", ")}`,
    `chapitre   ${chapter ? JSON.stringify(chapter) : "non détecté"}`,
    details.length > 0 ? `échecs     ${details.length}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
};

function toTitleCase(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
