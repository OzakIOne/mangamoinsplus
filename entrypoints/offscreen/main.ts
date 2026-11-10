import { base64ToBytes } from "@/lib/binary";
import { isCreateBlobUrlRequest, isRevokeBlobUrlRequest } from "@/lib/messages";

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isCreateBlobUrlRequest(message)) {
    const url = URL.createObjectURL(
      new Blob([base64ToBytes(message.base64)], { type: message.mime }),
    );
    sendResponse({ url });
    return true;
  }

  if (isRevokeBlobUrlRequest(message)) {
    URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
    return true;
  }

  return undefined;
});
