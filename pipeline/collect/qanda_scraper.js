const puppeteer = require("puppeteer");
const fs = require("fs");

const sets = [
  //   // --- Premium & Special Boosters ---
  //   "高級補充包 ONE PIECE CARD THE BEST vol.2【PRB-02】",
  //   "高級補充包 ONE PIECE CARD THE BEST【PRB-01】",
  //   "特殊補充包 EGGHEAD CRISIS【EB-04】",
  //   "特殊補充包 ONE PIECE Heroines Edition【EB-03】",
  //   "特殊補充包 Anime 25th collection【EB-02】",
  //   "特殊補充包 回憶收藏【EB-01】",

  //   // --- Main Boosters ---
  //   "補充包 神之島的冒險【OP-15】",
  //   "補充包 蒼海的七傑【OP-14】",
  //   "補充包 傳承的意志【OP-13】",
  //   "補充包 師徒的情義【OP-12】",
  //   "補充包 神速之拳【OP-11】",
  //   "補充包 王族血脈【OP-10】",
  //   "補充包 新世界的皇帝【OP-09】",
  //   "補充包 兩位傳奇【OP-08】",
  //   "補充包 500年後的未來【OP-07】",
  //   "補充包 雙壁的霸者【OP-06】",
  //   "補充包 新時代的主角【OP-05】",
  //   "補充包 陰謀王國【OP-04】",
  //   "補充包 強大的敵人【OP-03】",
  //   "補充包 頂點決戰【OP-02】",
  //   "補充包 ROMANCE DAWN【OP-01】",

  //   // --- Starter Decks ---
  "起始牌組EX 魯夫&艾斯【ST-30】",
  //   "起始牌組 EGGHEAD【ST-29】",
  //   "起始牌組 綠黃 大和【ST-28】",
  //   "起始牌組 黑 馬歇爾・D・汀奇【ST-27】",
  //   "起始牌組 紫黑 蒙其・D・魯夫【ST-26】",
  //   "起始牌組 藍 巴其【ST-25】",
  //   "起始牌組 綠 珠寶・波妮【ST-24】",
  //   "起始牌組 紅 傑克【ST-23】",
  //   "起始牌組 艾斯&紐蓋特【ST-22】",
  //   "起始牌組EX GEAR5【ST-21】",
  //   "起始牌組 黃 夏洛特・卡塔克利【ST-20】",
  //   "起始牌組 黑 斯摩格【ST-19】",
  //   "起始牌組 紫 蒙其・D・魯夫【ST-18】",
  //   "起始牌組 藍 唐吉訶德・多佛朗明哥【ST-17】",
  //   "起始牌組 綠 美音【ST-16】",
  //   "起始牌組 紅 艾德華・紐蓋特【ST-15】",
  //   "起始牌組 3D2Y【ST-14】",
  //   "究極牌組 三兄弟的情誼【ST-13】",
  //   "起始牌組 索隆&香吉士【ST-12】",
  //   "起始牌組 Side 美音【ST-11】",
  //   "究極牌組 “三船長”集結【ST-10】",
  //   "起始牌組 Side 大和【ST-09】",
  //   "起始牌組 Side 蒙其・D・魯夫【ST-08】",
  //   "起始牌組 BIG MOM海賊團【ST-07】",
  //   "起始牌組 海軍【ST-06】",
  //   "起始牌組 ONE PIECE FILM edition【ST-05】",
  //   "起始牌組 百獸海賊團【ST-04】",
  //   "起始牌組 王下七武海【ST-03】",
  //   "起始牌組 最可怕世代【ST-02】",
  //   "起始牌組 草帽一行人【ST-01】",

  //   // --- Special Sets ---
  //   "家庭牌組套裝",
  //   "推廣卡",
  //   "限定商品收錄卡牌",
];

(async () => {
  // Keep headless: false so you can watch it work!
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Disguise as a real browser to avoid blocks
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  );

  let masterQA = [];

  for (const setName of sets) {
    const encodedSet = encodeURIComponent(setName);
    const url = `https://asia-tc.onepiece-cardgame.com/rules/qa.php?tab=cardqa&type=1&series=${encodedSet}`;

    console.log(`📡 Fetching: ${setName}...`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

      // Wait 5 seconds for the JavaScript on the page to build the list
      await new Promise((r) => setTimeout(r, 5000));

      const pageData = await page.evaluate((currentSetName) => {
        const results = []; // <--- FIXED: Defined here inside the browser context
        const nums = Array.from(document.querySelectorAll(".qaNum"));
        const titles = Array.from(document.querySelectorAll(".qaTit"));
        const questions = Array.from(
          document.querySelectorAll(".questions dd"),
        );
        const answers = Array.from(document.querySelectorAll(".answer dd"));

        for (let i = 0; i < nums.length; i++) {
          const fullTitle = titles[i]?.innerText.trim() || "";

          // Filter out the generic booster set title
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
  const fs = require("fs");

  // This points to pipeline/collect/../data -> pipeline/data
  const outputPath = path.join(__dirname, "..", "data", "temp_qa_data.json");
  const outputDir = path.dirname(outputPath);

  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(masterQA, null, 2));

  console.log(`\n🎉 ALL DONE! Total items captured: ${masterQA.length}`);
  console.log(`📂 File ready at: ${outputPath}`);

  await browser.close();
})();
