const BASE64_CHUNK = 0x8000;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

const BASE64_MARKER = "base64,";

export type Bytes = Uint8Array<ArrayBuffer>;

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
};

export const base64ToBytes = (base64: string): Bytes => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const dataUrlToBytes = (dataUrl: string): Bytes => {
  const marker = dataUrl.indexOf(BASE64_MARKER);
  if (marker === -1) throw new Error("data URL sans contenu base64");
  return base64ToBytes(dataUrl.slice(marker + BASE64_MARKER.length));
};

export const imageMime = (extension: string): string =>
  IMAGE_MIME_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";

export const sniffImageExtension = (bytes: Uint8Array): string | undefined => {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return ".png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return ".gif";
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === "RIFF" && webp === "WEBP") return ".webp";
  return undefined;
};

export const imageExtension = ({ url, bytes }: { url: string; bytes: Uint8Array }): string => {
  const fromUrl = url.match(/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i)?.[1];
  if (fromUrl) return `.${fromUrl.toLowerCase()}`;
  return sniffImageExtension(bytes) ?? ".jpg";
};

export const looksLikeImage = (bytes: Uint8Array): boolean =>
  sniffImageExtension(bytes) !== undefined;
