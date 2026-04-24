// src/utils/cardHelpers.js

/**
 * Normalizes and secures One Piece card image URLs.
 * Handles parallel art suffixes and domain mapping.
 */
// export const getSafeImageUrl = (card) => {
//   if (!card) return "";

//   const targetDomain = "https://asia-tc.onepiece-cardgame.com";
//   const id = card.id || "";

//   // 1. Check if the ID has a suffix (Parallel/Promo/Reprint)
//   // If it does, we MUST build the URL from the ID to get the right art
//   if (id.includes("_p") || id.includes("_r")) {
//     return `${targetDomain}/images/cardlist/card/${id}.png`;
//   }

//   // 2. If no suffix, fall back to existing logic
//   if (card.img_full_url) {
//     if (card.img_full_url.includes("onepiece-cardgame.com")) {
//       return card.img_full_url.replace(/https?:\/\/[^/]+/, targetDomain);
//     }
//     return card.img_full_url;
//   }

//   if (card.img_url && card.img_url.includes("images/cardlist/")) {
//     const pathOnly = card.img_url.substring(card.img_url.indexOf("images/"));
//     return `${targetDomain}/${pathOnly}`;
//   }

//   // 3. Final fallback using the ID
//   return `${targetDomain}/images/cardlist/card/${id}.png`;
// };

// 17 April 2026 - New approach: All images are now hosted on Cloudinary under a consistent URL pattern. This eliminates the need for complex URL parsing and domain switching. The getSafeImageUrl function will now simply construct the Cloudinary URL based on the card ID, ensuring we always get the correct image without relying on Bandai's servers.
// src/utils/cardHelpers.js

const CLOUD_NAME = "dbc9yrfpw";
const FOLDER = "opc-images";

/**
 * Delivers optimized images via Cloudinary.
 * No longer relies on Bandai's inconsistent server paths.
 */
export const getSafeImageUrl = (card) => {
  if (!card || !card.id) {
    // Return a local placeholder if the card data is missing
    return "/images/card_back.png";
  }

  const cardId = card.id.toUpperCase();

  // f_auto: best format (WebP/AVIF)
  // q_auto: optimized quality
  // v1: cache versioning
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto/v1/${FOLDER}/${cardId}.png`;
};
