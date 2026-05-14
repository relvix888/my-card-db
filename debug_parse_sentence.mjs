import { parseEffect } from './src/components/practice/engine/effectParser.js';

// Test parsing of the sentence that contains the KO
// The parseSentences function processes individual sentences after splitting by 。
// Let's check if "之後，KO最多1張對手費用3以下的角色卡" is parsed correctly

// We need to test parseSentence directly — let's trace through the full effect
const effect = "【啟動主要】可將這張角色卡置為休息狀態：抽1張卡片，並廢棄1張自己的手牌。之後，KO最多1張對手費用3以下的角色卡。";

const result = parseEffect(effect);
const mainClause = result.find(c => c.timings.includes('啟動主要'));
if (mainClause) {
  console.log("Main clause actions:");
  mainClause.actions.forEach((a, i) => console.log(`  ${i}: ${JSON.stringify(a)}`));
} else {
  console.log("No main clause found, all clauses:", JSON.stringify(result, null, 2));
}
