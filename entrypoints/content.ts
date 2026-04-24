export default defineContentScript({
  matches: ["*://mangamoins.com/*"],
  main() {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "GET_CHAPTER_INFO") {
        const data = getChapterInfo();
        sendResponse(data);
        return true;
      }
    });
  },
});

function getChapterInfo() {
  const url = window.location.href;
  const match = url.match(/\/scan\/([^/?#]+)/);
  if (!match) return null;
  const chapterSlug = match[1];
  const totalPages = Number(
    document.getElementById("readerTotalPages")?.textContent
  );
  const img = document.querySelector("img[src*='.webp']") as HTMLImageElement;
  if (!img) return null;
  const src = img.src;

  const baseMatch = src.match(/(.*\/)(\d+)\.webp$/);
  if (!baseMatch) return null;
  const baseUrl = baseMatch[1];

  return {
    chapterSlug,
    totalPages,
    baseUrl,
  };
}
