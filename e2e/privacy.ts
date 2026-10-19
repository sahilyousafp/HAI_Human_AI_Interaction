import type { Page } from "@playwright/test";

/** Base64 prefixes of common image encodings: PNG, JPEG, WebP (RIFF), GIF. */
const IMAGE_BASE64 = /iVBORw0KGgo|\/9j\/[0-9A-Za-z+/]{8}|UklGR[0-9A-Za-z+/]{4}|R0lGOD/;
const MAX_TEXT_FRAME = 64 * 1024; // landmark frames are far smaller; anything this big is suspicious

export interface Violation {
  where: string;
  reason: string;
}

/**
 * Records everything the page sends (HTTP request bodies and WebSocket frames) and flags anything that looks
 * like image or video data. Used to prove camera frames never leave the browser.
 */
export function watchOutgoingData(page: Page): () => Violation[] {
  const violations: Violation[] = [];
  const inspectText = (where: string, text: string) => {
    if (text.includes("data:image") || text.includes("data:video"))
      violations.push({ where, reason: "data URL" });
    else if (IMAGE_BASE64.test(text)) violations.push({ where, reason: "base64 image signature" });
    else if (text.length > MAX_TEXT_FRAME)
      violations.push({ where, reason: `large payload (${text.length} chars)` });
  };

  page.on("request", (request) => {
    const body = request.postDataBuffer();
    const contentType = request.headers()["content-type"] ?? "";
    if (/^(image|video)\//.test(contentType) || contentType.includes("multipart/form-data")) {
      violations.push({
        where: `${request.method()} ${request.url()}`,
        reason: `content-type ${contentType}`,
      });
    }
    if (body && body.length > 0) inspectText(`${request.method()} ${request.url()}`, body.toString("latin1"));
  });

  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      if (typeof frame.payload !== "string") {
        violations.push({ where: `ws ${ws.url()}`, reason: `binary frame (${frame.payload.length} bytes)` });
      } else {
        inspectText(`ws ${ws.url()}`, frame.payload);
      }
    });
  });

  return () => violations;
}
