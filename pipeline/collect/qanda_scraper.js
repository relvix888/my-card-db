const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { packData, packOrder } = require("../../src/constants/packs");

// Build lookup: zh pack ID (e.g. "554116") → { title, code }
const idToSet = {};
for (const code of packOrder) {
  const pack = packData[code];
  if (pack && pack.zh) {
    idToSet[pack.zh.id] = { title: pack.zh.title, code };
  }
}

function buildSetsArray() {
  return packOrder
    .map((code) => {
      const pack = packData[code];
      if (!pack || !pack.zh) return null;
      return pack.zh.title;
    })
    .filter(Boolean);
}

// Accept optional CLI arg: zh pack ID (e.g. 554116) or set code (e.g. OP-16)
function resolveSets() {
  const arg = process.argv[2];
  if (!arg) return buildSetsArray();

  if (packData[arg] && packData[arg].zh) {
    console.log(`🎯 Single set mode: ${arg} → ${packData[arg].zh.title}`);
    return [packData[arg].zh.title];
  }

  if (idToSet[arg]) {
    const { title, code } = idToSet[arg];
    console.log(`🎯 Single set mode: ${arg} (${code}) → ${title}`);
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
        ? `https://asia-tc.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&series=${encodeURIComponent(set)}`
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

  const outputPath = path.join(__dirname, "..", "data", "temp_qa_data.json");
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(masterQA, null, 2));

  console.log(`\n🎉 Done! Total items: ${masterQA.length}`);
  console.log(`📂 Saved to: ${outputPath}`);

  await browser.close();
})();
