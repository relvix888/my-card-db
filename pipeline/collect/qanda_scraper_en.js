const puppeteer = require("puppeteer");
const fs = require("fs");

const sets = [
  // --- Premium Boosters ---
  "PREMIUM BOOSTER -ONE PIECE CARD THE BEST vol.2- [PRB-02]",
  "PREMIUM BOOSTER -ONE PIECE CARD THE BEST- [PRB-01]",

  // --- Extra Boosters ---
  "EXTRA BOOSTER -EGGHEAD CRISIS- [EB-04]",
  "EXTRA BOOSTER -ONE PIECE Heroines Edition- [EB-03]",
  "EXTRA BOOSTER -Anime 25th collection- [EB-02]",
  "EXTRA BOOSTER -Memorial Collection- [EB-01]",

  // --- Main Boosters ---
  "BOOSTER PACK -Adventure on KAMI’s Island- [OP-15]",
  "BOOSTER PACK -The Azure Sea’s Seven- [OP-14]",
  "BOOSTER PACK -Carrying on His Will- [OP-13]",
  "BOOSTER PACK -Legacy of the Master- [OP-12]",
  "BOOSTER PACK -A Fist of Divine Speed- [OP-11]",
  "BOOSTER PACK -Royal Blood- [OP-10]",
  "BOOSTER PACK -Emperors in the New World- [OP-09]",
  "BOOSTER PACK -Two Legends- [OP-08]",
  "BOOSTER PACK -500 Years in the Future- [OP-07]",
  "BOOSTER PACK -Wings of Captain- [OP-06]",
  "BOOSTER PACK -Awakening of the New Era- [OP-05]",
  "BOOSTER PACK -Kingdoms of Intrigue- [OP-04]",
  "BOOSTER PACK -Pillars of Strength- [OP-03]",
  "BOOSTER PACK -Paramount War- [OP-02]",
  "BOOSTER PACK -ROMANCE DAWN- [OP-01]",

  // --- Starter Decks ---
  "STARTER DECK EX -Luffy & Ace- [ST-30]",
  "STARTER DECK -EGGHEAD- [ST-29]",
  "STARTER DECK -Green/Yellow Yamato- [ST-28]",
  "STARTER DECK -Black Marshall.D.Teach- [ST-27]",
  "STARTER DECK -Purple/Black Monkey.D.Luffy- [ST-26]",
  "STARTER DECK -Blue Buggy- [ST-25]",
  "STARTER DECK -Green Jewelry Bonney- [ST-24]",
  "STARTER DECK -Red Shanks- [ST-23]",
  "STARTER DECK -Ace & Newgate- [ST-22]",
  "STARTER DECK EX -GEAR5- [ST-21]",
  "STARTER DECK -Yellow Charlotte Katakuri- [ST-20]",
  "STARTER DECK -Black Smoker- [ST-19]",
  "STARTER DECK -Purple Monkey.D.Luffy- [ST-18]",
  "STARTER DECK -Blue Donquixote Doflamingo- [ST-17]",
  "STARTER DECK -Green Uta- [ST-16]",
  "STARTER DECK -Red Edward.Newgate- [ST-15]",
  "STARTER DECK -3D2Y- [ST-14]",
  "ULTIMATE DECK -The Three Brothers' Bond- [ST-13]",
  "STARTER DECK -Zoro & Sanji- [ST-12]",
  "STARTER DECK -Side Uta- [ST-11]",
  "ULTIMATE DECK -The Three Captains- [ST-10]",
  "STARTER DECK -Side Yamato- [ST-09]",
  "STARTER DECK -Side Monkey.D.Luffy- [ST-08]",
  "STARTER DECK -Big Mom Pirates- [ST-07]",
  "STARTER DECK -The Navy- [ST-06]",
  "STARTER DECK -ONE PIECE FILM edition- [ST-05]",
  "STARTER DECK -Animal Kingdom Pirates- [ST-04]",
  "STARTER DECK -The Seven Warlords of the Sea- [ST-03]",
  "STARTER DECK -Worst Generation- [ST-02]",
  "STARTER DECK -Straw Hat Crew- [ST-01]",

  // --- Special Sets ---
  {
    name: "Promotion Card",
    url: "https://asia-en.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&freewords-cardqa=Promotion%20Card",
  },
];

(async () => {
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
        const questions = Array.from(
          document.querySelectorAll(".questions dd"),
        );
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

      console.log(`✅ Success! Found ${pageData.length} items for ${setName}.`);
      masterQA = [...masterQA, ...pageData];
    } catch (error) {
      console.error(`⚠️ Failed to load ${setName}: ${error.message}`);
    }
  }

  const path = require("path");

  const outputPath = path.join(__dirname, "..", "data", "temp_qa_data_en.json");
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(masterQA, null, 2));

  console.log(`\n🎉 ALL DONE! Total items captured: ${masterQA.length}`);
  console.log(`📂 File ready at: ${outputPath}`);

  await browser.close();
})();
