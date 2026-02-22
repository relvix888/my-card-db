import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query 
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'one-piece-card-db';

// --- 卡包數據對照表 (已按 PRB -> EB -> OP -> ST -> 其他 順序排列) ---
const packData = {
  "554302": { "id": "554302", "raw_title": "高級補充包 ONE PIECE CARD THE BEST vol.2【PRB-02】" },
  "554301": { "id": "554301", "raw_title": "高級補充包 ONE PIECE CARD THE BEST【PRB-01】" },
  "554204": { "id": "554204", "raw_title": "特殊補充包 EGGHEAD CRISIS【EB-04】" },
  "554203": { "id": "554203", "raw_title": "特殊補充包 ONE PIECE Heroines Edition【EB-03】" },
  "554202": { "id": "554202", "raw_title": "特殊補充包 Anime 25th collection【EB-02】" },
  "554201": { "id": "554201", "raw_title": "特殊補充包 回憶收藏【EB-01】" },
  "554114": { "id": "554114", "raw_title": "補充包 蒼海的七傑【OP-14】" },
  "554113": { "id": "554113", "raw_title": "補充包 傳承的意志【OP-13】" },
  "554112": { "id": "554112", "raw_title": "補充包 師徒的情義【OP-12】" },
  "554111": { "id": "554111", "raw_title": "補充包 神速之拳【OP-11】" },
  "554110": { "id": "554110", "raw_title": "補充包 王族血脈【OP-10】" },
  "554109": { "id": "554109", "raw_title": "補充包 新世界的皇帝【OP-09】" },
  "554108": { "id": "554108", "raw_title": "補充包 兩位傳奇【OP-08】" },
  "554107": { "id": "554107", "raw_title": "補充包 500年後的未來【OP-07】" },
  "554106": { "id": "554106", "raw_title": "補充包 雙壁的霸者【OP-06】" },
  "554105": { "id": "554105", "raw_title": "補充包 新時代的主角【OP-05】" },
  "554104": { "id": "554104", "raw_title": "補充包 陰謀王國【OP-04】" },
  "554103": { "id": "554103", "raw_title": "補充包 強大的敵人【OP-03】" },
  "554102": { "id": "554102", "raw_title": "補充包 頂點決戰【OP-02】" },
  "554101": { "id": "554101", "raw_title": "補充包 ROMANCE DAWN【OP-01】" },
  "554029": { "id": "554029", "raw_title": "起始牌組 EGGHEAD【ST-29】" },
  "554028": { "id": "554028", "raw_title": "起始牌組 綠黃 大和【ST-28】" },
  "554027": { "id": "554027", "raw_title": "起始牌組 黑 馬歇爾・D・汀奇【ST-27】" },
  "554026": { "id": "554026", "raw_title": "起始牌組 紫黑 蒙其・D・魯夫【ST-26】" },
  "554025": { "id": "554025", "raw_title": "起始牌組 藍 巴其【ST-25】" },
  "554024": { "id": "554024", "raw_title": "起始牌組 綠 珠寶・波妮【ST-24】" },
  "554023": { "id": "554023", "raw_title": "起始牌組 紅 傑克【ST-23】" },
  "554022": { "id": "554022", "raw_title": "起始牌組 艾斯&紐蓋特【ST-22】" },
  "554021": { "id": "554021", "raw_title": "起始牌組EX GEAR5【ST-21】" },
  "554020": { "id": "554020", "raw_title": "起始牌組 黃 夏洛特・卡塔克利【ST-20】" },
  "554019": { "id": "554019", "raw_title": "起始牌組 黑 斯摩格【ST-19】" },
  "554018": { "id": "554018", "raw_title": "起始牌組 紫 蒙其・D・魯夫【ST-18】" },
  "554017": { "id": "554017", "raw_title": "起始牌組 藍 唐吉訶德・多佛朗明哥【ST-17】" },
  "554016": { "id": "554016", "raw_title": "起始牌組 綠 美音【ST-16】" },
  "554015": { "id": "554015", "raw_title": "起始牌組 紅 艾德華・紐蓋特【ST-15】" },
  "554014": { "id": "554014", "raw_title": "起始牌組 3D2Y【ST-14】" },
  "554013": { "id": "554013", "raw_title": "究極牌組 三兄弟的情誼【ST-13】" },
  "554012": { "id": "554012", "raw_title": "起始牌組 索隆&香吉士【ST-12】" },
  "554011": { "id": "554011", "raw_title": "起始牌組 Side 美音【ST-11】" },
  "554010": { "id": "554010", "raw_title": "究極牌組 “三船長”集結【ST-10】" },
  "554009": { "id": "554009", "raw_title": "起始牌組 Side 大和【ST-09】" },
  "554008": { "id": "554008", "raw_title": "起始牌組 Side 蒙其・D・魯夫【ST-08】" },
  "554007": { "id": "554007", "raw_title": "起始牌組 BIG MOM海賊團【ST-07】" },
  "554006": { "id": "554006", "raw_title": "起始牌組 海軍【ST-06】" },
  "554005": { "id": "554005", "raw_title": "起始牌組 ONE PIECE FILM edition【ST-05】" },
  "554004": { "id": "554004", "raw_title": "起始牌組 百獸海賊團【ST-04】" },
  "554003": { "id": "554003", "raw_title": "起始牌組 王下七武海【ST-03】" },
  "554002": { "id": "554002", "raw_title": "起始牌組 最可怕世代【ST-02】" },
  "554001": { "id": "554001", "raw_title": "起始牌組 草帽一行人【ST-01】" },
  "554701": { "id": "554701", "raw_title": "家庭牌組套裝" },
  "554901": { "id": "554901", "raw_title": "推廣卡" },
  "554801": { "id": "554801", "raw_title": "限定商品收錄卡牌" }
};

// --- 強制顯示順序列表 (解決 JS 對數字 Key 的自動升序問題) ---
const packOrder = [
  "554302", "554301", // PRB
  "554204", "554203", "554202", "554201", // EB
  "554114", "554113", "554112", "554111", "554110", "554109", "554108", "554107", "554106", "554105", "554104", "554103", "554102", "554101", // OP
  "554029", "554028", "554027", "554026", "554025", "554024", "554023", "554022", "554021", "554020", "554019", "554018", "554017", "554016", "554015", "554014", "554013", "554012", "554011", "554010", "554009", "554008", "554007", "554006", "554005", "554004", "554003", "554002", "554001", // ST
  "554701", "554901", "554801" // Others
];

const App = () => {
  const [cards, setCards] = useState([]);
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState([]); 
  const [selectedColors, setSelectedColors] = useState([]);
  const [filterCategory, setFilterCategory] = useState('所有');
  const [filterType1, setFilterType1] = useState('所有');
  const [filterType2, setFilterType2] = useState('所有');
  const [typeLogic, setTypeLogic] = useState('AND'); // 'AND' 或 'OR'
  const [filterPackId, setFilterPackId] = useState('所有'); // 新增卡包篩選狀態
  const [hideReprint, setHideReprint] = useState(false); // 新增：隱藏再錄卡狀態
  const [isImporting, setIsImporting] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);

  const typeOptions = ["所有", "草帽一行人", "海軍", "超新星", "王下七武海", "FILM", "四皇", "和之國", "BIG MOM海賊團", "白鬍子海賊團", "百獸海賊團", "多雷斯羅薩", "唐吉訶德海賊團", "革命軍", "蛋頭", "東方藍", "魚人族", "動物", "哈特海賊團", "B・W", "恐怖三桅帆船海賊團", "紅髮海賊團", "純毛族", "推進城", "空島", "阿拉巴斯坦王國", "基德海賊團", "黑鬍子海賊團", "龐克哈薩特", "賓什莫克家", "紅鞘九人眾", "魚人島", "九蛇海賊團", "光月家", "太陽海賊團", "人魚族", "ODYSSEY", "波妮海賊團", "W7", "CP0", "CP9", "巨人族", "天龍人", "杰爾馬66", "SWORD", "科學家", "羅傑海傑團", "十字公會", "SMILE", "磁鼓王國", "音樂", "弗克西海賊團", "五老星", "CROSS GUILD", "香朵拉的戰士", "白鬍子海賊團旗下", "西凱阿爾王國", "前B・W", "歡樂友人", "前羅傑海賊團", "火戰車海賊團", "GC", "哥雅王國", "惡龍海賊團", "多雷古海賊團", "亞馬遜百合", "海賊王", "貌美海賊團", "霍金斯海賊團", "前海軍", "杰爾馬王國", "GRAN TESORO", "巴特俱樂部", "海王類", "山賊", "巴其海賊團", "ONAIR海賊團", "新海軍", "新魚人海賊團", "歐哈拉", "加亞島", "黑貓海賊團", "破戒僧海賊團", "佛夏村", "熾天使", "克利克海賊團", "頓達塔族", "格列佛海賊團", "生物兵器", "金獅子海賊團", "海賊萬博會", "西摩志基村", "神官", "前洛克斯海賊團", "前白鬍子海賊團", "獄卒獸", "狙擊島", "八寶水軍", "世界政府", "科学者", "黑炭家", "佛朗基家族", "魯魯西亞王國", "明月族", "原白鬍子海賊團", "黑桃海賊團", "飛魚騎士", "新巨兵海賊團", "猿山聯合軍", "洛克斯海賊團", "巴其海賊團船長", "多雷斯羅薩恐怖三桅帆船海賊團", "時光旅詩", "貝拉密海賊團", "聖地馬力喬亞", "福爾夏特島", "？", "祭典島", "造船町", "飛行海賊團", "布魯賈姆海賊團", "前CP9", "前惡龍海賊團", "前Ｂ・Ｗ", "巴其宅急便", "原羅傑海傑團", "倫巴海賊團", "阿奇諾家族", "冒牌草帽一行人", "妖精", "前倫巴海賊團", "阿爾凱米", "托雷傑海賊團", "CP8", "瓦爾德海賊團", "CP6", "CP7", "疫災", "羔羊之家", "圓蛋糕島", "普羅丹斯王國", "月", "甲羅海賊團", "原倫巴海賊團", "衛伯之母", "長環長島", "記者", "桃鬍子海賊團", "福連伯斯", "巴鐵利拉", "邪惡黑組織磁鼓王國", "新聞記者", "波音列島", "Monsters", "獄卒獸", "亞爾麗塔海賊團", "約塔瑪利亞大船團", "阿斯卡島", "追逐草帽大冒險", "撲克牌海賊團", "機關島", "原惡龍海賊團", "新魚人海賊団", "艾拉德哥海賊團", "王冠島", "原洛克斯海賊團", "植物學者", "ボニー海賊団", "スリラーバーク海賊団", "黑鬍子海賊團傘下", "褐鬍子海賊團", "前翻滾海賊團", "前BIG MOM海賊團", "元B・W", "水母海賊團", "嘉斯帕德海賊團"];

  const quickKeywords = ["【登場時】", "【啟動主要】", "【攻擊時】", "【我方回合中】", "【我方回合結束時】", "【反擊】", "【對方攻擊時】", "【對方回合中】", "【KO時】", "【觸發器】", "【速攻】", "【速攻：角色】", "【防禦】", "【防禦不可】", "【雙重攻擊】", "【消失】"];

  const colorMap = { '紅色': 'Red', '綠色': 'Green', '藍色': 'Blue', '紫色': 'Purple', '黑色': 'Black', '黃色': 'Yellow' };
  const categoryMap = { '領航卡': 'Leader', '角色卡': 'Character', '事件卡': 'Event', '舞台卡': 'Stage' };

  // 使用 packOrder 生成最終顯示的清單
  const sortedPackList = useMemo(() => {
    return packOrder.map(id => packData[id]).filter(p => p !== undefined);
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        // We removed the check for __initial_auth_token
        await signInAnonymously(auth);
      } catch (err) { 
        console.error("Auth error:", err); 
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const cardsRef = collection(db, 'artifacts', appId, 'public', 'data', 'cards');
    const unsubscribe = onSnapshot(cardsRef, (snapshot) => {
      const cardData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setCards(cardData);
    }, (err) => console.error("Firestore error:", err));
    return () => unsubscribe();
  }, [user]);

  const toggleKeyword = (keyword) => {
    setSelectedKeywords(prev => 
      prev.includes(keyword) ? prev.filter(k => k !== keyword) : [...prev, keyword]
    );
  };

  const toggleColor = (color) => {
    if (color === '所有') {
      setSelectedColors([]);
      return;
    }
    setSelectedColors(prev => 
      prev.includes(color) ? prev.filter(c => c !== color) : [...prev, color]
    );
  };
const handleImport = async () => {
  if (!jsonInput || !user) {
    alert("Please paste JSON and ensure you are logged in!");
    return;
  }
  try {
    const data = JSON.parse(jsonInput);
    const cardsArray = Array.isArray(data) ? data : [data];
    setIsImporting(true);
    for (const card of cardsArray) {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'cards', card.id), card);
    }
    setJsonInput('');
    setIsImporting(false);
    alert("Upload Successful!"); // <--- Add this
  } catch (err) { 
    console.error('Import error:', err); 
    setIsImporting(false);
    alert("Upload Failed: " + err.message); // <--- Add this
  }
};

  /**
   * 修正後的圖片路徑邏輯
   * 根據使用者提供的正確網域：asia-tc.onepiece-cardgame.com
   */
  const getSafeImageUrl = (card) => {
    if (!card) return '';
    
    const targetDomain = "https://asia-tc.onepiece-cardgame.com";
    
    // 1. 如果有 img_full_url，將其 domain 替換成正確的 asia-tc
    if (card.img_full_url) {
        if (card.img_full_url.includes('onepiece-cardgame.com')) {
            return card.img_full_url.replace(/https?:\/\/[^\/]+/, targetDomain);
        }
        return card.img_full_url;
    }

    // 2. 如果只有相對路徑 img_url (例如 ../images/...)
    if (card.img_url && card.img_url.includes('images/cardlist/')) {
        const pathOnly = card.img_url.substring(card.img_url.indexOf('images/'));
        return `${targetDomain}/${pathOnly}`;
    }

    // 3. 兜底方案：利用 ID 構造
    if (card.id) {
        return `${targetDomain}/images/cardlist/card/${card.id}.png`;
    }

    return 'https://via.placeholder.com/300x420?text=No+Image';
  };

  const parseNumericFilter = (term) => {
    const match = term.match(/^([><]=?|=)?(\d+)$/);
    return match ? { operator: match[1] || '=', value: parseInt(match[2], 10) } : null;
  };

  const compare = (cardValue, filter) => {
    const val = parseInt(cardValue, 10);
    if (isNaN(val)) return false;
    switch (filter.operator) {
      case '>': return val > filter.value;
      case '<': return val < filter.value;
      case '>=': return val >= filter.value;
      case '<=': return val <= filter.value;
      case '=': return val === filter.value;
      default: return val === filter.value;
    }
  };

  const filteredCards = useMemo(() => {
    const conditions = searchTerm.split(/[,，]/).filter(c => c.trim() !== "");
    return cards.filter(card => {
            // 再錄卡過濾邏輯：ID 結尾包含 _p 或 _r 加數字
      if (hideReprint) {
        if (card.id && /_[pr]\d+$/i.test(card.id)) {
          return false;
        }
      }

      const matchesSearch = conditions.every(cond => {
        const term = cond.toLowerCase().trim();

        const counterMatch = term.match(/^\+(\d+)$/);
        if (counterMatch) {
            const targetCounter = parseInt(counterMatch[1], 10);
            const cardCounter = card.counter === null || card.counter === undefined ? 0 : parseInt(card.counter, 10);
            return cardCounter === targetCounter;
        }

        const nf = parseNumericFilter(term);
        if (term === '0') return (card.counter === 0 || card.cost === 0 || card.power === 0);
        if (nf) {
          if (nf.value <= 15) return compare(card.cost, nf);
          return compare(card.power, nf);
        }
        return (
          (card.name || '').toLowerCase().includes(term) || 
          (card.id || '').toLowerCase().includes(term) ||
          (card.effect || '').toLowerCase().includes(term) ||
          (card.types && card.types.some(t => t.toLowerCase().includes(term)))
        );
      });
      const matchesKeywords = selectedKeywords.every(k => (card.effect || '').includes(k) || (card.trigger || '').includes(k));
      
      let matchesColor = true;
      if (selectedColors.length > 0) {
        if (selectedColors.includes('多色')) {
            matchesColor = card.colors?.length > 1;
        } else {
            const mappedColors = selectedColors.map(c => colorMap[c]);
            matchesColor = card.colors?.some(c => mappedColors.includes(c));
        }
      }

      let matchesCategory = filterCategory === '所有' ? true : card.category === categoryMap[filterCategory];
      
      // 特徵篩選邏輯 (雙下拉選單 + AND/OR)
      let matchesType = true;
      const type1Active = filterType1 !== '所有';
      const type2Active = filterType2 !== '所有';
      
      if (type1Active && type2Active) {
        const hasT1 = card.types?.includes(filterType1);
        const hasT2 = card.types?.includes(filterType2);
        matchesType = typeLogic === 'AND' ? (hasT1 && hasT2) : (hasT1 || hasT2);
      } else if (type1Active) {
        matchesType = card.types?.includes(filterType1);
      } else if (type2Active) {
        matchesType = card.types?.includes(filterType2);
      }

      // 卡包篩選邏輯
      let matchesPack = filterPackId === '所有' ? true : String(card.pack_id) === String(filterPackId);

      return matchesSearch && matchesKeywords && matchesColor && matchesCategory && matchesType && matchesPack;
    });
  }, [cards, searchTerm, selectedKeywords, selectedColors, filterCategory, filterType1, filterType2, typeLogic, filterPackId, hideReprint]);


  // --- 效果文字格式化渲染邏輯 ---
  const renderFormattedEffect = (text) => {
    if (!text) return null;
    
    // 預處理換行與移除 HTML 標籤
    const plainText = text.replace(/<br>/g, '\n');

    // 定義各類別關鍵字與其對應樣式
    const rules = [
      { 
        keywords: ["【主要】", "【啟動主要】", "【攻擊時】","【對方攻擊時】", "【KO時】", "【我方回合中】", "【對方回合中】", "【我方回合結束時】", "【登場時】"], 
        style: "bg-blue-600 text-white px-1 py-0.5 rounded text-[13px] font-bold mx-0.5" 
      },
      { 
        keywords: ["【每回合1次】", "【反擊】"], 
        style: "bg-red-600 text-white px-1 py-0.5 rounded text-[13px] font-bold mx-0.5" 
      },
      { 
        keywords: ["【速攻】", "【防禦】", "【速攻：角色】", "【防禦不可】", "【雙重攻擊】", "【消失】"], 
        style: "bg-orange-500 text-white px-1 py-0.5 rounded text-[13px] font-bold mx-0.5" 
      },
      { 
        keywords: ["【咚‼×1】", "【咚‼×2】", "【咚‼×3】", "【咚‼×4】", "【咚‼×5】", "【咚‼×6】", "【咚‼×7】", "【咚‼×8】", "【咚‼×9】", "【咚‼×10】"], 
        style: "bg-slate-900 text-white px-1 py-0.5 rounded text-[13px] font-bold mx-0.5" 
      },
      { 
        keywords: ["【觸發器】"], 
        style: "bg-yellow-200 text-black px-1 py-0.5 rounded text-[13px] font-bold mx-0.5" 
      }
    ];

    const allKeywords = rules.flatMap(r => r.keywords);
      const keywordRegexPart = allKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

      // REFINED REGEX: 
      // 1. Static Keywords
      // 2. The specific !! symbols
      // 3. The Bold Pattern: Grabs non-bracket text followed by optional parens and a colon
      const regex = new RegExp(`(${keywordRegexPart}|!!|‼|[^\\s\\n【】(]+(?:\\([^)]*\\))?[:：])`, 'g');

      const parts = plainText.split(regex);

      return parts.map((part, index) => {
        if (!part) return null;

        // A. Handle Keyword Boxes (【...】)
        const rule = rules.find(r => r.keywords.includes(part));
        if (rule) {
          const subParts = part.split(/(‼|!!)/g);
          return (
            <span key={index} className={rule.style}>
              {subParts.map((sub, i) => (
                (sub === '‼' || sub === '!!') 
                  ? <span key={i} className="inline-flex"><span>!</span><span>!</span></span> 
                  : sub
              ))}
            </span>
          );
        }

        // B. Handle !! or ‼ marks (Standalone)
        if (part === '!!' || part === '‼') {
          return <span key={index} className="inline-flex"><span>!</span><span>!</span></span>;
        }

        // C. Handle the Bold Text (Text ending in : or ：)
        if (/[：:]$/.test(part) && !part.startsWith('【')) {
              const match = part.match(/^([^()]+)(\([^)]*\))?([:：])$/);
              
              if (match) {
                const [_, mainText, parens, colon] = match;
                return (
                  <span key={index}>
                    {/* 1. Bold White Text (Main Cost) */}
                    <span className="font-bold text-white">
                      {mainText.split(/(‼|!!)/g).map((s, i) => 
                        (s === '‼' || s === '!!') ? 
                        <span key={i} className="inline-flex"><span>!</span><span>!</span></span> : s
                      )}
                    </span>
                    
                    {/* 2. Parentheses: NOW FIXES !! INSIDE TOO */}
                    {parens && (
                      <span className="font-normal">
                        {parens.split(/(‼|!!)/g).map((s, i) => 
                          (s === '‼' || s === '!!') ? 
                          <span key={i} className="inline-flex"><span>!</span><span>!</span></span> : s
                        )}
                      </span>
                    )}
                    
                    {/* 3. The Colon */}
                    <span className="font-bold text-white">{colon}</span>
                  </span>
                );
              }
            }

        // D. Normal text (This is where the text AFTER the colon now lives)
        return <span key={index}>{part}</span>;
      });
    };

  const navigateCard = useCallback((direction) => {
    if (!selectedCard) return;
    const currentIndex = filteredCards.findIndex(c => c.id === selectedCard.id);
    if (currentIndex === -1) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex >= 0 && nextIndex < filteredCards.length) {
      setSelectedCard(filteredCards[nextIndex]);
    }
  }, [selectedCard, filteredCards]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedCard) return;
      if (e.key === 'ArrowLeft') navigateCard(-1);
      if (e.key === 'ArrowRight') navigateCard(1);
      if (e.key === 'Escape') setSelectedCard(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCard, navigateCard]);

  const currentIndex = selectedCard ? filteredCards.findIndex(c => c.id === selectedCard.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < filteredCards.length - 1;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 font-sans">
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-center">
        <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-red-500 bg-clip-text text-transparent">One Piece卡牌遊戲卡表</h1>
        <button onClick={() => setIsImporting(!isImporting)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors text-sm font-medium">
          {isImporting ? '取消' : '導入數據'}
        </button>
      </header>

      {isImporting && (
        <div className="max-w-7xl mx-auto mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl">
          <textarea className="w-full h-40 bg-slate-900 border border-slate-600 rounded-lg p-3 font-mono text-sm mb-4" placeholder="貼上 JSON 數據..." value={jsonInput} onChange={e => setJsonInput(e.target.value)} />
          <button onClick={handleImport} className="w-full py-3 bg-green-600 rounded-lg font-bold">確認匯入</button>
        </div>
      )}

      <main className="max-w-7xl mx-auto flex flex-col md:flex-row gap-8">
        <aside className="w-full md:w-64 space-y-6">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
            <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">搜尋條件</h3>
            <input type="text" placeholder="名稱/編號/效果/+2000" className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm mb-4" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            
            {/* 新增：不顯示再錄卡勾選框 */}
            <label className="flex items-center gap-2 cursor-pointer mb-4 p-2 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
              <input 
                type="checkbox" 
                checked={hideReprint} 
                onChange={e => setHideReprint(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-500"
              />
              <span className="text-xs font-bold text-slate-300">不顯示異圖或再錄卡</span>
            </label>

            {/* 卡包篩選下拉選單 */}
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-2 tracking-widest">收錄卡包</p>
            <select value={filterPackId} onChange={e => setFilterPackId(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer mb-4">
              <option value="所有">所有卡包</option>
              {sortedPackList.map(pack => (
                <option key={pack.id} value={pack.id}>{pack.raw_title}</option>
              ))}
            </select>

            <div className="space-y-3">
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">特徵篩選 (複合)</p>
              <select value={filterType1} onChange={e => setFilterType1(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer">
                {typeOptions.map(option => <option key={`t1-${option}`} value={option}>{option}</option>)}
              </select>
              
              <div className="flex justify-center items-center gap-2 py-1">
                <button 
                  onClick={() => setTypeLogic('AND')}
                  className={`flex-1 text-[10px] py-1 rounded-l border ${typeLogic === 'AND' ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-500'}`}
                >
                  AND (且)
                </button>
                <button 
                  onClick={() => setTypeLogic('OR')}
                  className={`flex-1 text-[10px] py-1 rounded-r border ${typeLogic === 'OR' ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-500'}`}
                >
                  OR (或)
                </button>
              </div>

              <select value={filterType2} onChange={e => setFilterType2(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 px-3 text-sm cursor-pointer mb-4">
                {typeOptions.map(option => <option key={`t2-${option}`} value={option}>{option}</option>)}
              </select>
            </div>
            
            <div className="mt-6 flex flex-wrap gap-1.5">
              {quickKeywords.map(keyword => (
                <button key={keyword} onClick={() => toggleKeyword(keyword)} className={`text-[10px] px-2 py-1 rounded border transition-all ${selectedKeywords.includes(keyword) ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-700/50 border-slate-600 text-slate-400'}`}>
                  {keyword.replace(/【|】/g, '')}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
            <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">類別與顏色</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              {['所有', '紅色', '綠色', '藍色', '紫色', '黑色', '黃色', '多色'].map(c => {
                const isActive = c === '所有' ? selectedColors.length === 0 : selectedColors.includes(c);
                return (
                  <button 
                    key={c} 
                    onClick={() => toggleColor(c)} 
                    className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${isActive ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_8px_rgba(37,99,235,0.5)]' : 'bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600'}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {['所有', '領航卡', '角色卡', '事件卡', '舞台卡'].map(cat => (
                <label key={cat} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="radio" checked={filterCategory === cat} onChange={() => setFilterCategory(cat)} className="accent-blue-500" />
                  <span className={filterCategory === cat ? 'text-blue-400 font-bold' : 'text-slate-400'}>{cat}</span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex-1">
          <div className="flex justify-between items-center mb-4 px-1">
            <p className="text-xs text-slate-400">顯示數量: <span className="text-blue-400 font-bold">{filteredCards.length}</span></p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredCards.map(card => (
              <div key={card.id} onClick={() => setSelectedCard(card)} className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 hover:border-blue-500 transition-all cursor-pointer group shadow-sm">
                <div className="aspect-[2.5/3.5] relative overflow-hidden bg-slate-950">
                  <img 
                    src={getSafeImageUrl(card)} 
                    alt={card.name} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                    loading="lazy"
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = `https://via.placeholder.com/300x420?text=${card.id}`;
                    }} 
                  />
                </div>
                <div className="p-3">
                  <p className="text-[10px] text-slate-500 font-mono font-bold">{card.id}</p>
                  <h4 className="font-bold text-sm truncate text-slate-100">{card.name}</h4>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="max-w-7xl mx-auto w-full mt-12 py-8 border-t border-slate-800 text-center">
        <p className="text-xs text-slate-500 leading-relaxed">
          All information on this site is copyrighted by ©Eiichiro Oda/Shueisha, Toei Animation and Bandai Namco.
        </p>
        <p className="text-[10px] text-slate-600 mt-2 uppercase tracking-widest font-bold">
          One Piece Card Database Project
        </p>
      </footer>

      {selectedCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/95 backdrop-blur-md" onClick={() => setSelectedCard(null)}>
          {hasPrev && (
            <button onClick={(e) => { e.stopPropagation(); navigateCard(-1); }} className="absolute left-1 md:left-6 z-[70] w-12 h-24 md:w-16 md:h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-r-xl md:rounded-full transition-all border-y border-r md:border border-white/10 text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
            </button>
          )}
          {hasNext && (
            <button onClick={(e) => { e.stopPropagation(); navigateCard(1); }} className="absolute right-1 md:right-6 z-[70] w-12 h-24 md:w-16 md:h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-l-xl md:rounded-full transition-all border-y border-l md:border border-white/10 text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}

          <div className="bg-slate-800 w-full md:max-w-4xl h-full md:h-auto md:max-h-[90vh] overflow-y-auto rounded-none md:rounded-2xl p-6 md:p-10 flex flex-col md:flex-row gap-8 relative border-none md:border border-slate-700 shadow-2xl scrollbar-hide" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedCard(null)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-transform hover:scale-110 z-[80]">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            <div className="w-full md:w-5/12 flex-shrink-0 flex justify-center mb-[-10px] md:mb-0">
              <img 
                src={getSafeImageUrl(selectedCard)} 
                className="rounded-xl shadow-2xl w-full max-w-[320px] md:max-w-none md:sticky md:top-0 border border-slate-700" 
                alt={selectedCard.name} 
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = `https://via.placeholder.com/300x420?text=${selectedCard.id}`;
                }}
              />
            </div>

            <div className="w-full md:w-7/12 space-y-2 text-left pb-20 md:pb-0">

             <div className="bg-slate-600/50 p-3 rounded-xl border-l-4 border-blue-500">
              {/* Changed mb-2 (8px) to mb-1 (4px) */}

              <p className="text-base leading-relaxed text-slate-100 whitespace-pre-wrap font-medium">
                {renderFormattedEffect(selectedCard.effect) || '無效果內容'}
              </p>
            </div>

              {selectedCard.trigger && (<div className="bg-yellow-500/20 p-3 rounded-xl border-l-4 border-yellow-500"><p className="text-base leading-relaxed text-yellow-100 font-medium whitespace-pre-wrap">{renderFormattedEffect(selectedCard.trigger)}</p></div>)}
              


              {/* The Name (moved closer with negative margin) */}
              <div className="-mt-1">
                <h2 className="text-xl md:text-4xl font-black leading-tight text-white">
                  {selectedCard.name}
                </h2>
              </div>

              <div>
                <div className="flex flex-wrap gap-2">{selectedCard.types?.map(t => <span key={t} className="px-3 py-1 bg-blue-900/30 text-blue-300 border border-blue-500/30 rounded-md text-sm font-bold">{t}</span>)}</div>
              </div>

              <div className="flex items-center gap-3"> 
                {/* The ID */}
                <span className="text-blue-500 font-mono font-bold tracking-widest text-xs leading-none">
                  {selectedCard.id}
                </span>

                {/* The Color Circles */}
                <div className="flex gap-1.5">
                  {selectedCard.colors?.map(c => (
                    <span 
                      key={c} 
                      className="w-2.5 h-2.5 rounded-full border border-white/20 shadow-sm" 
                      style={{ backgroundColor: c.toLowerCase() }}
                    ></span>
                  ))}
                </div>
              </div>

              {selectedCard.pack_id && packData[selectedCard.pack_id] && (
                  <p className="text-xs text-slate-400 mt-2">收錄於：{packData[selectedCard.pack_id].raw_title}</p>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;