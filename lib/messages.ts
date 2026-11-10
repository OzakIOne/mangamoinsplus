export type OutputFormat = "cbz" | "images";

interface MangamoinsChapter {
  site: "mangamoins";
  chapterSlug: string;
  totalPages: number;
  baseUrl: string;
  firstPage?: number;
  pagePadding?: number;
  imageExtension?: string;
}

interface RaijinChapter {
  site: "raijin";
  mangaSlug: string;
  chapterSlug: string;
  imageUrls?: string[];
  baseUrl?: string;
  pagePadding?: number;
  imageExtension?: string;
}

export type ChapterInfo = MangamoinsChapter | RaijinChapter;

export interface DownloadRequest {
  type: "DOWNLOAD_CHAPTER";
  format: OutputFormat;
  tabId?: number;
  chapter: ChapterInfo;
}

export interface DownloadResult {
  downloaded: number;
  error?: string;
  file?: string;
  skipped?: number;
  details?: string[];
  build?: string;
  dnr?: number;
}

export interface DownloadProgress {
  type: "DOWNLOAD_PROGRESS";
  done: number;
  total: number;
}

export interface FetchImageRequest {
  type: "FETCH_IMAGE";
  url: string;
}

export interface FetchImageResponse {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface CreateBlobUrlRequest {
  type: "CREATE_BLOB_URL";
  base64: string;
  mime: string;
}

export interface RevokeBlobUrlRequest {
  type: "REVOKE_BLOB_URL";
  url: string;
}

const hasStringField = (value: object, key: string): value is Record<typeof key, string> =>
  key in value && typeof Reflect.get(value, key) === "string";

export const isChapterInfo = (value: unknown): value is ChapterInfo => {
  if (typeof value !== "object" || value === null) return false;
  if (!("site" in value)) return false;
  if (Reflect.get(value, "site") === "mangamoins") return hasStringField(value, "chapterSlug");
  if (Reflect.get(value, "site") === "raijin") return hasStringField(value, "chapterSlug");
  return false;
};

export const isDownloadRequest = (value: unknown): value is DownloadRequest => {
  if (typeof value !== "object" || value === null) return false;
  return "type" in value && Reflect.get(value, "type") === "DOWNLOAD_CHAPTER";
};

export const isDownloadProgress = (value: unknown): value is DownloadProgress => {
  if (typeof value !== "object" || value === null) return false;
  return "type" in value && Reflect.get(value, "type") === "DOWNLOAD_PROGRESS";
};

export const isCreateBlobUrlRequest = (value: unknown): value is CreateBlobUrlRequest => {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || Reflect.get(value, "type") !== "CREATE_BLOB_URL") return false;
  return hasStringField(value, "base64") && hasStringField(value, "mime");
};

export const isRevokeBlobUrlRequest = (value: unknown): value is RevokeBlobUrlRequest => {
  if (typeof value !== "object" || value === null) return false;
  if (!("type" in value) || Reflect.get(value, "type") !== "REVOKE_BLOB_URL") return false;
  return hasStringField(value, "url");
};

export const readDownloadResult = (value: unknown): DownloadResult | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const downloaded = Reflect.get(value, "downloaded");
  if (typeof downloaded !== "number") return undefined;
  const error = Reflect.get(value, "error");
  const file = Reflect.get(value, "file");
  const skipped = Reflect.get(value, "skipped");
  const details = Reflect.get(value, "details");
  const build = Reflect.get(value, "build");
  const dnr = Reflect.get(value, "dnr");
  return {
    downloaded,
    ...(typeof error === "string" ? { error } : {}),
    ...(typeof file === "string" ? { file } : {}),
    ...(typeof skipped === "number" ? { skipped } : {}),
    ...(Array.isArray(details) ? { details: details.filter((d): d is string => typeof d === "string") } : {}),
    ...(typeof build === "string" ? { build } : {}),
    ...(typeof dnr === "number" ? { dnr } : {}),
  };
};
