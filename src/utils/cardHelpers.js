// src/utils/cardHelpers.js

/**
 * Normalizes and secures One Piece card image URLs.
 * Handles parallel art suffixes and domain mapping.
 */
export const getSafeImageUrl = (card) => {
  if (!card) return "";

  const targetDomain = "https://asia-tc.onepiece-cardgame.com";
  const id = card.id || "";

  // 1. Check if the ID has a suffix (Parallel/Promo/Reprint)
  // If it does, we MUST build the URL from the ID to get the right art
  if (id.includes("_p") || id.includes("_r")) {
    return `${targetDomain}/images/cardlist/card/${id}.png`;
  }

  // 2. If no suffix, fall back to existing logic
  if (card.img_full_url) {
    if (card.img_full_url.includes("onepiece-cardgame.com")) {
      return card.img_full_url.replace(/https?:\/\/[^/]+/, targetDomain);
    }
    return card.img_full_url;
  }

  if (card.img_url && card.img_url.includes("images/cardlist/")) {
    const pathOnly = card.img_url.substring(card.img_url.indexOf("images/"));
    return `${targetDomain}/${pathOnly}`;
  }

  // 3. Final fallback using the ID
  return `${targetDomain}/images/cardlist/card/${id}.png`;
};
