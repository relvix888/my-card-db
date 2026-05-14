import { parseEffect } from './src/components/practice/engine/effectParser.js';

const effect = "這張角色卡的費用+4。<br>【啟動主要】可將這張角色卡置為休息狀態：抽1張卡片，並廢棄1張自己的手牌。之後，KO最多1張對手費用3以下的角色卡。";
const result = parseEffect(effect);
console.log(JSON.stringify(result, null, 2));
