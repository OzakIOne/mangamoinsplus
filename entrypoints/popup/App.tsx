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
    setMessage(
      result.file
        ? `✅ ${result.downloaded} pages → ${result.file}`
        : `✅ ${result.downloaded} page${result.downloaded > 1 ? "s" : ""} téléchargée${result.downloaded > 1 ? "s" : ""}`,
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
    </div>
  );
}

function toTitleCase(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
