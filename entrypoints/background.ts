export default defineBackground({
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === "DOWNLOAD_CHAPTER") {
        downloadChapter(message);
      }
    });
  },
});

async function downloadChapter({
  chapterSlug,
  totalPages,
  baseUrl,
}: {
  chapterSlug: string;
  totalPages: number;
  baseUrl: string;
}) {
  const downloads = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = String(i).padStart(2, "0");
    const imageUrl = `${baseUrl}${page}.webp`;
    const filename = `${chapterSlug}/page_${page}.webp`;

    downloads.push(
      browser.downloads.download({
        url: imageUrl,
        filename,
        saveAs: false,
      })
    );
  }

  await Promise.all(downloads);
}
