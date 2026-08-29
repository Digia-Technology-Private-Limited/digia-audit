export type PlayStoreUrlValidation =
  | { valid: true; packageId: string }
  | { valid: false; reason: "empty" | "malformed" | "unsupported" };

const PLAY_STORE_HOST = "play.google.com";
const PLAY_STORE_PATH = "/store/apps/details";

export function validatePlayStoreUrl(value: string): PlayStoreUrlValidation {
  const input = value.trim();

  if (!input) {
    return { valid: false, reason: "empty" };
  }

  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (url.protocol !== "https:" || url.hostname !== PLAY_STORE_HOST) {
    return { valid: false, reason: "unsupported" };
  }

  if (url.pathname !== PLAY_STORE_PATH) {
    return { valid: false, reason: "unsupported" };
  }

  const packageId = url.searchParams.get("id")?.trim();

  if (!packageId) {
    return { valid: false, reason: "malformed" };
  }

  return { valid: true, packageId };
}

export function getPlayStoreUrlError(reason: Exclude<PlayStoreUrlValidation, { valid: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Enter a Google Play Store app URL.";
    case "malformed":
      return "Enter a valid app URL, like https://play.google.com/store/apps/details?id=...";
    case "unsupported":
      return "Use a Google Play Store app URL.";
  }
}
