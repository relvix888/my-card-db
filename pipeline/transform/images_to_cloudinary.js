const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");

// 1. CONFIGURATION
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.REACT_APP_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.REACT_APP_CLOUDINARY_API_KEY,
  api_secret: process.env.REACT_APP_CLOUDINARY_API_SECRET,
});

const localImagesDir = path.resolve(
  __dirname,
  "../../../opc-uploader-images/images/",
);
const CLOUDINARY_FOLDER = "opc-images";

async function uploadImages() {
  const files = fs
    .readdirSync(localImagesDir)
    .filter((f) => f.endsWith(".png"));
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
