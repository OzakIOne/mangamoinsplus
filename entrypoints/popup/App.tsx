import { useState } from "react";

interface ChapterInfo {
  site?: string;
  mangaSlug?: string;
  chapterSlug: string;
  totalPages?: number;
  baseUrl?: string;
  pagePadding?: number;
  imageExtension?: string;
  imageUrls?: string[];
}

export default function App() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [chapterInfo, setChapterInfo] = useState<ChapterInfo | null>(null);

  async function detectChapter() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;

    const info = await browser.tabs.sendMessage(tab.id, {
      type: "GET_CHAPTER_INFO",
    });

    if (!info) {
      setStatus("error");
      setProgress("Not on a manga chapter page");
      return;
    }

    setChapterInfo(info);
  }

  async function handleDownload() {
    if (!chapterInfo) return;
    setStatus("loading");
    setProgress("Downloading...");

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const res = (await browser.runtime.sendMessage({
        type: "DOWNLOAD_CHAPTER",
        tabId: tab?.id,
        ...chapterInfo,
      })) as { downloaded?: number; error?: string } | undefined;

      const n = res?.downloaded ?? 0;
      if (res?.error) {
        setStatus("error");
        setProgress(`❌ ${n} page(s) avant échec — ${res.error}`);
      } else if (n > 0) {
        setStatus("done");
        setProgress(`${n} page${n > 1 ? "s" : ""} downloaded!`);
      } else {
        setStatus("error");
        setProgress("Aucune page téléchargée. Recharge la page du chapitre et réessaie.");
      }
    } catch (e) {
      setStatus("error");
      setProgress(`Error: ${String(e)}`);
    }
  }

  // Auto-detect on mount
  useState(() => { detectChapter(); });

  return (
    <div style={{ width: 300, padding: 16, fontFamily: "sans-serif" }}>
      <h2>🎨 Manga Downloader</h2>

      {chapterInfo ? (
        <>
          {chapterInfo.mangaSlug && (
            <p>
              📚{" "}
              <strong>
                {toTitleCase(chapterInfo.mangaSlug)}
              </strong>
            </p>
          )}
          <p>
            📄 Chapter: <strong>{chapterInfo.chapterSlug}</strong>
            {chapterInfo.imageUrls?.length
              ? ` · ${chapterInfo.imageUrls.length} pages`
              : ""}
          </p>
          <button
            onClick={handleDownload}
            disabled={status === "loading"}
            style={{ width: "100%", padding: 8, cursor: "pointer" }}
          >
            {status === "loading" ? "Downloading..." : "⬇️ Download Chapter"}
          </button>
        </>
      ) : (
        <p>Navigate to a manga chapter page first.</p>
      )}

      {progress && <p style={{ marginTop: 8, fontSize: 12 }}>{progress}</p>}
    </div>
  );
}

function toTitleCase(slug: string) {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
