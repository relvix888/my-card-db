const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");

// 1. CONFIGURATION
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_API_SECRET,
});

const localImagesDir = path.resolve(
  __dirname,
  "../../../opc-uploader-images/images/",
);
const dataFolderPath = path.resolve(
  __dirname,
  "../../../opc-uploader/data/ZH/",
);
const CLOUDINARY_FOLDER = "opc-images";

async function uploadImages() {
  // Usage:
  //   node images_to_cloudinary.js                          → all images
  //   node images_to_cloudinary.js 554801 554901            → by pack ID
  //   node images_to_cloudinary.js --json path/to/file.json → by arbitrary JSON file
  const args = process.argv.slice(2);

  let files = fs.readdirSync(localImagesDir).filter((f) => f.endsWith(".png"));

  const jsonFlagIdx = args.indexOf("--json");
  if (jsonFlagIdx !== -1) {
    // Load card IDs from an arbitrary JSON file
    const jsonPaths = args.slice(jsonFlagIdx + 1);
    const cardIds = new Set();
    jsonPaths.forEach((jsonPath) => {
      const resolved = path.resolve(jsonPath);
      if (!fs.existsSync(resolved)) {
        console.warn(`⚠️  JSON file not found: ${resolved}`);
        return;
      }
      const cards = JSON.parse(fs.readFileSync(resolved, "utf8"));
      (Array.isArray(cards) ? cards : [cards]).forEach(
        (c) => c.id && cardIds.add(c.id.toUpperCase()),
      );
      console.log(`📄 Loaded ${cardIds.size} card IDs from ${path.basename(resolved)}`);
    });
    files = files.filter((f) => cardIds.has(path.parse(f).name.toUpperCase()));
    console.log(`🔍 Matched ${files.length} image file(s)`);
  } else if (args.length > 0) {
    // Filter by pack IDs (reads from ZH/ folder)
    const cardIds = new Set();
    args.forEach((pack) => {
      const jsonPath = path.join(dataFolderPath, `cards_${pack}.json`);
      if (!fs.existsSync(jsonPath)) {
        console.warn(`⚠️  No JSON found for pack ${pack}, skipping filter`);
        return;
      }
      const cards = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      cards.forEach((c) => c.id && cardIds.add(c.id.toUpperCase()));
    });
    files = files.filter((f) => cardIds.has(path.parse(f).name.toUpperCase()));
    console.log(`📦 Filtering to packs: ${args.join(", ")} (${files.length} file(s) matched)`);
  }

  console.log(`☁️  Found ${files.length} images for upload...`);

  for (const file of files) {
    const publicId = path.parse(file).name; // e.g., ST01-001
    const filePath = path.join(localImagesDir, file);

    try {
      // The 'uploader.explicit' check prevents re-uploading if it already exists
      await cloudinary.uploader.upload(filePath, {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId,
        overwrite: false, // Don't waste credits re-uploading existing images
      });
      console.log(`✅ Uploaded: ${publicId}`);
    } catch (error) {
      console.error(`❌ Failed: ${publicId}`, error.message);
    }
  }
  console.log("🚀 All uploads complete!");
}

uploadImages();
