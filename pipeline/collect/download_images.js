const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Adjust these paths based on your folder structure
const dataFolderPath = path.resolve(
  __dirname,
  "../../../opc-uploader/data/ZH/",
);
const outputFolder = path.resolve(
  __dirname,
  "../../../opc-uploader-images/images",
);

// CONFIGURATION: Adjust these if you get blocked
const BATCH_SIZE = 3; // How many images to download at once
const DELAY_MS = 500; // Wait 0.5 seconds between batches
const RETRY_ATTEMPTS = 3; // How many times to retry a failed image

if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

// Helper to create a delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadImage(url, cardId, attempt = 1) {
  const filePath = path.join(outputFolder, `${cardId.toUpperCase()}.png`);
  if (fs.existsSync(filePath)) return "skipped";

  let currentUrl = url;

  // Logic for different retry stages
  if (attempt === 2) {
    // Try switching domain to asia-tc
    currentUrl = url.replace("asia-hk", "asia-tc");
    console.log(`\n🔄 [${cardId}] Attempt 2: Trying asia-tc domain...`);
  } else if (attempt === 3) {
    // Try asia-tc without the query string (?suffix)
    const tcUrl = url.replace("asia-hk", "asia-tc");
    const urlObj = new URL(tcUrl);
    currentUrl = `${urlObj.origin}${urlObj.pathname}`;
    console.log(`\n🔄 [${cardId}] Attempt 3: Trying cleaned asia-tc URL...`);
  } else if (attempt === 4) {
    // Try original asia-hk without the query string
    const urlObj = new URL(url);
    currentUrl = `${urlObj.origin}${urlObj.pathname}`;
    console.log(`\n🔄 [${cardId}] Attempt 4: Trying cleaned original URL...`);
  }

  try {
    const response = await axios({
      url: currentUrl,
      method: "GET",
      responseType: "stream",
      timeout: 10000,
      headers: {
        Referer: "https://asia-hk.onepiece-cardgame.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve("downloaded"));
      writer.on("error", (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
  } catch (error) {
    // If we have more retry strategies left, go to the next attempt level
    if (attempt < 4) {
      // Small delay to be nice to the server before trying the next variation
      await sleep(300);
      return downloadImage(url, cardId, attempt + 1);
    }
    throw error;
  }
}

async function startDownload() {
  // e.g. node download_images.js 554901 554801 554101
  const packFilters = process.argv.slice(2);

  const files = fs
    .readdirSync(dataFolderPath)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => packFilters.length === 0 || packFilters.some((p) => f.includes(p)));

  if (packFilters.length > 0) {
    console.log(`📦 Filtering to packs: ${packFilters.join(", ")} (${files.length} file(s) matched)`);
  }

  let allCards = [];

  // 1. Gather all card data
  files.forEach((file) => {
    try {
      const content = JSON.parse(
        fs.readFileSync(path.join(dataFolderPath, file), "utf8"),
      );
      allCards = allCards.concat(Array.isArray(content) ? content : [content]);
    } catch (e) {
      console.error(`Error reading ${file}:`, e.message);
    }
  });

  // Filter out cards without images or IDs
  //   const queue = allCards.filter((c) => c.img_full_url && c.id);
  // Add this inside your queue filter
  const queue = allCards.filter(
    (c) => c.img_full_url && c.id,
    //   !c.id.startsWith("ST29") &&
    //   !c.id.startsWith("ST30") &&
    //   !c.id.startsWith("OP15"), // Temporarily skip the broken set
  );
  console.log(`🚀 Starting download for ${queue.length} images...`);
  console.log(`Settings: Batch Size ${BATCH_SIZE}, Delay ${DELAY_MS}ms\n`);

  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 2. Process in batches
  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map((card) =>
        downloadImage(card.img_full_url, card.id)
          .then((res) => res)
          .catch((err) => {
            console.error(`❌ Failed ${card.id}:`, err.message);
            return "failed";
          }),
      ),
    );

    // Track results
    results.forEach((res) => {
      if (res === "downloaded") downloadedCount++;
      if (res === "skipped") skippedCount++;
      if (res === "failed") failedCount++;
    });

    // 3. Forced Cooldown
    process.stdout.write(
      `\rProgress: ${i + batch.length}/${queue.length} | Success: ${downloadedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`,
    );
    await sleep(DELAY_MS);
  }

  console.log("\n\n✅ Process Complete!");
  console.log(`Total Downloaded: ${downloadedCount}`);
  console.log(`Total Skipped (Already Exist): ${skippedCount}`);
  console.log(`Total Failed: ${failedCount}`);

  // 4. Generate the Failure Report
  if (failedCount > 0) {
    const failedList = [];

    // Check which cards from our queue are missing their images
    queue.forEach((card) => {
      const filePath = path.join(outputFolder, `${card.id.toUpperCase()}.png`);

      if (!fs.existsSync(filePath)) {
        failedList.push({
          id: card.id,
          name: card.name,
          pack_id: card.pack_id || "N/A", // Pulls from your source JSON
          url: card.img_full_url,
        });
      }
    });

    const reportPath = path.join(__dirname, "failed_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(failedList, null, 2));

    console.log(`\n📄 Failure report generated: ${reportPath}`);
    console.log(
      `Audit these cards to see if the pack_id or title suggests a naming pattern issue.`,
    );
  }
}

startDownload();
