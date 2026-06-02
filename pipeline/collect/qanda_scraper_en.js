const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { packData, packOrder } = require("../../src/constants/packs");

// Build lookup: en pack ID (e.g. "556116") → { title, code }
const idToSet = {};
for (const code of packOrder) {
  const pack = packData[code];
  if (pack && pack.en) {
    idToSet[pack.en.id] = { title: pack.en.title, code };
  }
}

function buildSetsArray() {
  return packOrder
    .map((code) => {
      const pack = packData[code];
      if (!pack || !pack.en) return null;
      // PROMO uses a freewords search URL instead of series
      if (code === "PROMO") {
        return {
          name: pack.en.title,
          url: "https://asia-en.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&freewords-cardqa=Promotion%20Card",
        };
      }
      return pack.en.title;
    })
    .filter(Boolean);
}

// Accept optional CLI arg: en pack ID (e.g. 556116) or set code (e.g. OP-16)
function resolveSets() {
  const arg = process.argv[2];
  if (!arg) return buildSetsArray();

  if (packData[arg] && packData[arg].en) {
    console.log(`🎯 Single set mode: ${arg} → ${packData[arg].en.title}`);
    const code = arg;
    if (code === "PROMO") {
      return [
        {
          name: packData[arg].en.title,
          url: "https://asia-en.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&freewords-cardqa=Promotion%20Card",
        },
      ];
    }
    return [packData[arg].en.title];
  }

  if (idToSet[arg]) {
    const { title, code } = idToSet[arg];
    console.log(`🎯 Single set mode: ${arg} (${code}) → ${title}`);
    if (code === "PROMO") {
      return [
        {
          name: title,
          url: "https://asia-en.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&freewords-cardqa=Promotion%20Card",
        },
      ];
    }
    return [title];
  }

  console.error(`❌ Unknown pack ID or set code: "${arg}"`);
  console.error(`Valid set codes: ${packOrder.join(", ")}`);
  process.exit(1);
}

(async () => {
  const sets = resolveSets();

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  );

  let masterQA = [];

  for (const set of sets) {
    const setName = typeof set === "string" ? set : set.name;
    const url =
      typeof set === "string"
        ? `https://asia-en.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&series=${encodeURIComponent(set)}`
        : set.url;

    console.log(`📡 Fetching: ${setName}...`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 5000));

      const pageData = await page.evaluate((currentSetName) => {
        const results = [];
        const nums = Array.from(document.querySelectorAll(".qaNum"));
        const titles = Array.from(document.querySelectorAll(".qaTit"));
        const questions = Array.from(document.querySelectorAll(".questions dd"));
        const answers = Array.from(document.querySelectorAll(".answer dd"));

        for (let i = 0; i < nums.length; i++) {
          const fullTitle = titles[i]?.innerText.trim() || "";
          if (fullTitle !== currentSetName && fullTitle !== "") {
            const cardIdMatch = fullTitle.match(/[A-Z0-9]+-\d+/);
            results.push({
              qaNum: nums[i].innerText.trim(),
              title: fullTitle,
              cardId: cardIdMatch ? cardIdMatch[0] : null,
              question: questions[i]?.innerText.trim() || "",
              answer: answers[i]?.innerText.trim() || "",
            });
          }
        }
        return results;
      }, setName);

      console.log(`✅ Found ${pageData.length} items for ${setName}.`);
      masterQA = [...masterQA, ...pageData];
    } catch (error) {
      console.error(`⚠️ Failed to load ${setName}: ${error.message}`);
    }
  }

  const outputPath = path.join(__dirname, "..", "data", "temp_qa_data_en.json");
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(masterQA, null, 2));

  console.log(`\n🎉 Done! Total items: ${masterQA.length}`);
  console.log(`📂 Saved to: ${outputPath}`);

  await browser.close();
})();
