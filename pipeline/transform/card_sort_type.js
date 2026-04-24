const fs = require("fs");
const path = require("path");
const os = require("os");

// 1. Define paths
const folderPath = path.resolve(os.homedir(), "opc-uploader", "data");
const outputPath = path.resolve(__dirname, "../../src/data/sorted_types.json");

function processCardTypes() {
  if (!fs.existsSync(folderPath)) {
    console.error(`Error: Folder not found at ${folderPath}`);
    return;
  }

  let allCards = [];
  const files = fs.readdirSync(folderPath);

  // --- STEP 1: LOAD ALL DATA ---
  files.forEach((file) => {
    if (path.extname(file) === ".json") {
      const fullPath = path.join(folderPath, file);
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (Array.isArray(data)) {
          allCards = allCards.concat(data);
        } else {
          allCards.push(data);
        }
      } catch (e) {
        console.error(`Failed to parse ${file}:`, e.message);
      }
    }
  });

  console.log(`Loaded ${allCards.length} cards. Processing types...`);

  // --- STEP 2: EXTRACT AND COUNT ---
  const typeCounts = {};

  allCards.forEach((card, index) => {
    // DEBUG: Log the first card structure to terminal
    if (index === 0) {
      console.log("DEBUG: First card structure key check:", Object.keys(card));
    }

    // Check common variations of the key name
    const traits = card.types || card.type || card.traits;

    if (traits) {
      if (Array.isArray(traits)) {
        traits.forEach((t) => {
          if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
        });
      } else if (typeof traits === "string") {
        traits.split(",").forEach((t) => {
          const trimmed = t.trim();
          if (trimmed) typeCounts[trimmed] = (typeCounts[trimmed] || 0) + 1;
        });
      }
    }
  });

  // --- STEP 3: SORT AND SAVE ---
  const sortedTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    fs.writeFileSync(outputPath, JSON.stringify(sortedTypes, null, 2), "utf8");
    console.log(
      `✅ Success! ${sortedTypes.length} unique types saved to: ${outputPath}`,
    );
  } catch (err) {
    console.error("❌ Failed to save file:", err);
  }
}

processCardTypes();
