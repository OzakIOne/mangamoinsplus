import { useState } from "react";

interface ChapterInfo {
  mangaSlug: string;
  chapterSlug: string;
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
    setProgress("Starting download...");

    try {
      await browser.runtime.sendMessage({
        type: "DOWNLOAD_CHAPTER",
        ...chapterInfo,
      });
      setStatus("done");
      setProgress("All pages sent to downloads!");
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
          <p>📄 Chapter: <strong>{chapterInfo.chapterSlug}</strong></p>
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
