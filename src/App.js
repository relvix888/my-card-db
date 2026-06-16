import React, { useState, useEffect, useMemo, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";
import { useTranslation } from "react-i18next";

import CardQA from "./components/CardQA";
import cardPrices from "./data/price_final.json";
import {
  BLOCK_1_EXCEPTIONS,
  BANNED_LIST,
  RESTRICTED_PAIRS,
  UNLIMITED_COPIES,
} from "./data/rotation";
import topDecksData from "./data/deck_final.json";
import prevMetaData from "./data/deck_prev_meta.json";
import ggDecksData from "./data/deck_gg_raw_final.json";
import officialDecksData from "./data/official_decks.json";
import enCardsData from "./data/en_cards.json";
import sortedTypesEn from "./data/sorted_types_en.json";
import { getSafeImageUrl } from "./utils/cardHelpers";
import { packData, packOrder } from "./constants/packs";
import { KEYWORD_MAP, KEYWORD_RULES as rules } from "./constants/keywords";
import ImportView from "./components/ImportView";
import SearchView from "./components/SearchView";
import DeckView from "./components/DeckView";
import MarketplaceView from "./components/MarketplaceView";
import PracticeView from "./components/practice/PracticeView";
import OnlinePvpLobby from "./components/pvp/OnlinePvpLobby";
import PvpGameContainer from "./components/pvp/PvpGameContainer";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "one-piece-card-db";

const initialTurns = (dons) =>
  dons.map((don) => ({
    don,
    slots: Array(5).fill(null),
    operators: Array(4).fill("or"),
  }));

// --- 輔助函數：取得基礎 ID (處理 _px 或 _rx 後綴) ---
const getBaseId = (id) => {
  if (!id) return "";
  return id.split(/_[pr]\d+$/i)[0].toUpperCase();
};

// 1. Create a function to turn the array into a searchable Map
const initializeMarketData = (rawData) => {
  const map = {};
  // Assuming rawData.prices is the array containing your EB02-061_p2 object
  const priceArray = Array.isArray(rawData) ? rawData : rawData.prices || [];

  priceArray.forEach((item) => {
    map[item.id] = {
      ...item,
      type: "SELL", // Default to WTS
      price: item.hkd ? String(item.hkd) : "", // This populates your input box
    };
  });
  return map;
};

const defaultFilters = {
  selectedBlocks: ["1_legal", "2", "3", "4", "5"],
  searchTerm: "",
  selectedKeywords: [],
  isExcludeMode: false,
  selectedColors: [],
  selectedCosts: [],
  selectedRarity: [],
  filterCategory: "all",
  filterType1: "all",
  filterType2: "all",
  typeLogic: "AND",
  filterPackId: "554116",
  hideReprint: true,
  hidePromo: true,
  showCurve: false,
};

const App = () => {
  const { t, i18n } = useTranslation();
  const langCode = i18n.language.split("-")[0]; // 'en', 'zh', 'ja', etc.
  const toggleLanguage = () => {
    const newLang = i18n.language.startsWith("en") ? "zh" : "en";
    i18n.changeLanguage(newLang);
  };

  const [cards, setCards] = useState([]);
  const [isCardsLoading, setIsCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState(null);
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [isExcludeMode, setIsExcludeMode] = useState(false);
  const [selectedColors, setSelectedColors] = useState([]);
  const [selectedCosts, setSelectedCosts] = useState([]);
  const [selectedRarity, setSelectedRarity] = useState([]);
  const [filterCategory, setFilterCategory] = useState("all");
  const [selectedAttributes, setSelectedAttributes] = useState([]);
  const [filterType1, setFilterType1] = useState("all");
  const [filterType2, setFilterType2] = useState("all");
  const [typeLogic, setTypeLogic] = useState("AND"); // 'AND' 或 'OR'
  const [filterPackId, setFilterPackId] = useState(
    langCode === "en" ? "556116" : defaultFilters.filterPackId,
  );
  const [hideReprint, setHideReprint] = useState(true); // 新增：隱藏再錄卡狀態
  const [hidePromo, setHidePromo] = useState(true); // 新增：隱藏促銷卡狀態
  const [selectedBlocks, setSelectedBlocks] = useState([
    "1_legal",
    "2",
    "3",
    "4",
    "5",
  ]);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingDeck, setIsImportingDeck] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [deckInput, setDeckInput] = useState("");
  const [selectedCard, setSelectedCard] = useState(null);
  const [appMode, setAppMode] = useState(() =>
    sessionStorage.getItem("pvpGameId") ? "ONLINE_PVP" : "IMPORT",
  );
  const [deckList, setDeckList] = useState({});
  const [isMarketMode, setIsMarketMode] = useState(false);
  const [marketList, setMarketList] = useState({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [marketData, setMarketData] = useState(() =>
    initializeMarketData(cardPrices),
  );
  const [firstCurveTurns, setFirstCurveTurns] = useState(
    initialTurns([1, 3, 5, 7, 9]),
  );
  const [secondCurveTurns, setSecondCurveTurns] = useState(
    initialTurns([2, 4, 6, 8, 10]),
  );
  const [showCurve, setShowCurve] = useState(false);
  const [selectedLeader, setSelectedLeader] = useState(null);
  const [leaderStats, setLeaderStats] = useState({}); // Stores { "ID": count }
  const [pvpGameId, setPvpGameId] = useState(
    () => sessionStorage.getItem("pvpGameId") ?? null,
  );
  const [pvpMyRole, setPvpMyRole] = useState(
    () => sessionStorage.getItem("pvpMyRole") ?? null,
  );

  const activeList = isMarketMode ? marketList : deckList;
  const updateActiveList = isMarketMode ? setMarketList : setDeckList;

  const renderContent = () => {
    const advancedSearchProps = {
      showAdvanced,
      setShowAdvanced,
      typeLogic,
      setTypeLogic,
      filterType1,
      setFilterType1,
      filterType2,
      setFilterType2,
      typeOptions,
      sortedTypesEn,
      filterCategory,
      setFilterCategory,
      selectedColors,
      toggleColor,
      selectedRarity,
      setSelectedRarity,
      selectedAttributes,
      setSelectedAttributes,
      selectedKeywords,
      toggleKeyword,
      quickKeywords,
      getKeywordStyle,
      selectedBlocks,
      setSelectedBlocks,
      isExcludeMode,
      setIsExcludeMode,
      searchTerm,
      setSearchTerm,
      filterPackId,
      setFilterPackId,
      sortedPackList,
      hideReprint,
      setHideReprint,
      hidePromo,
      setHidePromo,
      setSelectedColors,
      colorMap,
      categoryMap,
      rarityMap,
      toggleRarity,
      attributeMap,
      toggleAttribute,
      selectedCosts,
      setSelectedCosts,
    };

    const commonProps = {
      setSelectedCard,
      updateDeckCount,
      appMode,
      marketData,
      toggleMarketType,
      updatePrice,
      deckList,
      marketList,
      isMarketMode,
      totalDeckCount,
    };

    switch (appMode) {
      case "IMPORT":
        return (
          <ImportView
            cards={overlaidCards}
            topDecksData={topDecksData}
            prevMetaData={prevMetaData}
            ggDecksData={ggDecksData}
            officialDecksData={officialDecksData}
            getSafeImageUrl={getSafeImageUrl}
            generateMetaDeck={generateMetaDeck}
            deckInput={deckInput}
            setDeckInput={setDeckInput}
            handleImportDeckCode={handleImportDeckCode}
            setAppMode={setAppMode}
            legalityWarning={legalityWarning}
          />
        );

      case "SEARCH":
        return (
          <SearchView
            key={isMarketMode ? "market-search" : "deck-search"}
            filteredCards={filteredCards}
            resetFilters={resetFilters}
            {...advancedSearchProps} // This spreads all 25+ props automatically!
            {...commonProps}
          />
        );

      case "DECK":
        return (
          <DeckView
            orderedDeck={orderedDeck}
            selectedLeader={selectedLeader}
            totalDeckCount={totalDeckCount}
            setDeckList={setDeckList}
            setSelectedCard={setSelectedCard}
            updateDeckCount={updateDeckCount}
            generateShareUrl={generateShareUrl}
            legalityWarning={legalityWarning}
            deckTableData={deckTableData}
            copySimFormat={copySimFormat}
            // NEW ANALYSIS PROPS
            deckAnalysis={deckAnalysis}
            showCurve={showCurve}
            setShowCurve={setShowCurve}
            firstCurveTurns={firstCurveTurns}
            setFirstCurveTurns={setFirstCurveTurns}
            secondCurveTurns={secondCurveTurns}
            setSecondCurveTurns={setSecondCurveTurns}
            cards={overlaidCards}
            deckList={deckList}
            getSafeImageUrl={getSafeImageUrl}
            hoveredTrait={hoveredTrait}
            setHoveredTrait={setHoveredTrait}
            setAppMode={setAppMode}
            {...commonProps}
          />
        );

      case "MARKETPLACE":
        return (
          <MarketplaceView
            orderedDeck={orderedDeck}
            selectedLeader={selectedLeader}
            totalDeckCount={totalDeckCount}
            setDeckList={setDeckList}
            setSelectedCard={setSelectedCard}
            marketData={marketData}
            toggleMarketType={toggleMarketType}
            updatePrice={updatePrice}
            deckTableData={deckTableData}
            copySimFormat={copySimFormat}
            deckValuation={deckValuation}
            bulkUpdateRarity={bulkUpdateRarity}
            deckList={deckList}
            generateMarketShareUrl={generateMarketShareUrl}
            cards={overlaidCards}
            legalityWarning={legalityWarning}
            dataIntegrityWarning={dataIntegrityWarning}
            isMarketMode={isMarketMode}
            setIsMarketMode={setIsMarketMode}
            setMarketList={setMarketList}
            {...commonProps}
          />
        );

      case "PRACTICE": {
        const practiceCards = cards.map((c) => {
          const en = enCardsData[c.id];
          return en
            ? {
                ...c,
                enEffect: en.effect ?? null,
                enTrigger: en.trigger ?? null,
                enName: en.name ?? null,
                enTypes: en.types ?? null,
              }
            : c;
        });
        return (
          <PracticeView
            deckList={deckList}
            selectedLeader={
              selectedLeader
                ? (practiceCards.find((c) => c.id === selectedLeader.id) ??
                  selectedLeader)
                : null
            }
            cards={practiceCards}
            onClose={() => setAppMode("DECK")}
            ggDecksData={ggDecksData}
            officialDecksData={officialDecksData}
            prevMetaData={prevMetaData}
          />
        );
      }

      case "ONLINE_PVP_LOBBY":
        return (
          <OnlinePvpLobby
            db={db}
            user={user}
            cards={cards}
            deckList={deckList}
            selectedLeader={selectedLeader}
            onGameStart={(gameId, myRole) => {
              sessionStorage.setItem("pvpGameId", gameId);
              sessionStorage.setItem("pvpMyRole", myRole);
              setPvpGameId(gameId);
              setPvpMyRole(myRole);
              setAppMode("ONLINE_PVP");
            }}
            onClose={() => setAppMode("DECK")}
          />
        );

      case "ONLINE_PVP":
        return (
          <PvpGameContainer
            db={db}
            gameId={pvpGameId}
            myRole={pvpMyRole}
            cards={cards}
            deckList={deckList}
            selectedLeader={selectedLeader}
            onClose={() => {
              sessionStorage.removeItem("pvpGameId");
              sessionStorage.removeItem("pvpMyRole");
              setPvpGameId(null);
              setPvpMyRole(null);
              setAppMode("DECK");
            }}
          />
        );

      default:
        return null;
    }
  };

  const generateMetaDeck = (leader) => {
    if (!leader || !leader.id) return;

    const leaderId = leader.id.toUpperCase();
    const entry = topDecksData[leaderId];

    // 1. Handle the new structure: entry might be { deck: "...", count: 5 }
    // or the old structure: entry might be "4xID,1xID..."
    let deckString = typeof entry === "object" ? entry.deck : entry;

    if (deckString) {
      console.log(`Found Meta Deck for ${leaderId}:`, deckString);

      // 2. Load the cards into your deck state
      handleImportDeckCode(deckString);

      // 3. Switch UI to Deck View
      setAppMode("DECK");

      // 4. Smooth scroll to top for better UX
      window.scrollTo({ top: 0, behavior: "smooth" });

      // Optional: Log the popularity if it exists
      if (entry.count) {
        console.log(
          `This leader has appeared ${entry.count} times in the meta.`,
        );
      }
    } else {
      console.warn("No deck data found for Leader ID:", leaderId);
      // Optional: Alert the user in their native language
      alert(`暫無 ${leaderId} 的熱門牌組資料 / No meta data found.`);
    }
  };

  const typeOptions = [
    "所有",
    "草帽一行人",
    "海軍",
    "超新星",
    "王下七武海",
    "FILM",
    "四皇",
    "和之國",
    "多雷斯羅薩",
    "白鬍子海賊團",
    "BIG MOM海賊團",
    "革命軍",
    "唐吉訶德海賊團",
    "東方藍",
    "百獸海賊團",
    "蛋頭",
    "空島",
    "動物",
    "魚人族",
    "哈特海賊團",
    "B・W",
    "恐怖三桅帆船海賊團",
    "紅髮海賊團",
    "純毛族",
    "推進城",
    "阿拉巴斯坦王國",
    "基德海賊團",
    "龐克哈薩特",
    "黑鬍子海賊團",
    "九蛇海賊團",
    "魚人島",
    "紅鞘九人眾",
    "賓什莫克家",
    "光月家",
    "人魚族",
    "波妮海賊團",
    "太陽海賊團",
    "ODYSSEY",
    "W7",
    "巨人族",
    "CP0",
    "CP9",
    "科學家",
    "天龍人",
    "杰爾馬66",
    "SWORD",
    "羅傑海賊團",
    "十字公會",
    "磁鼓王國",
    "SMILE",
    "香朵拉的戰士",
    "弗克西海賊團",
    "音樂",
    "五老星",
    "CROSS GUILD",
    "白鬍子海賊團旗下",
    "前B・W",
    "西凱阿爾王國",
    "前羅傑海賊團",
    "克利克海賊團",
    "歡樂友人",
    "火戰車海賊團",
    "GC",
    "哥雅王國",
    "巴特俱樂部",
    "惡龍海賊團",
    "巴其海賊團",
    "貌美海賊團",
    "多雷古海賊團",
    "黑貓海賊團",
    "亞馬遜百合",
    "海賊王",
    "霍金斯海賊團",
    "神官",
    "山賊",
    "前海軍",
    "杰爾馬王國",
    "加亞島",
    "GRAN TESORO",
    "新魚人海賊團",
    "海王類",
    "ONAIR海賊團",
    "新海軍",
    "破戒僧海賊團",
    "歐哈拉",
    "頓達塔族",
    "佛夏村",
    "熾天使",
    "格列佛海賊團",
    "生物兵器",
    "金獅子海賊團",
    "海賊萬博會",
    "八寶水軍",
    "西摩志基村",
    "前洛克斯海賊團",
    "前白鬍子海賊團",
    "獄卒獸",
    "狙擊島",
    "世界政府",
    "科学者",
    "新巨兵海賊團",
    "黑炭家",
    "佛朗基家族",
    "魯魯西亞王國",
    "明月族",
    "原白鬍子海賊團",
    "黑桃海賊團",
    "飛魚騎士",
    "亞爾麗塔海賊團",
    "倫巴海賊團",
    "猿山聯合軍",
    "洛克斯海賊團",
    "巴其海賊團船長",
    "多雷斯羅薩",
    "恐怖三桅帆船海賊團",
    "時光旅詩",
    "貝拉密海賊團",
    "聖地馬力喬亞",
    "月",
    "原倫巴海賊團",
    "福爾夏特島",
    "？",
    "翻滾海賊團",
    "祭典島",
    "造船町",
    "飛行海賊團",
    "布魯賈姆海賊團",
    "前CP9",
    "前惡龍海賊團",
    "前Ｂ・Ｗ",
    "蒙加羅王國",
    "巴其宅急便",
    "原羅傑海賊團",
    "阿奇諾家族",
    "冒牌草帽一行人",
    "妖精",
    "前倫巴海賊團",
    "阿爾凱米",
    "托雷傑海賊團",
    "CP8",
    "瓦爾德海賊團",
    "CP6",
    "CP7",
    "疫災",
    "羔羊之家",
    "圓蛋糕島",
    "普羅丹斯王國",
    "甲羅海賊團",
    "衛伯之母",
    "長環長島",
    "記者",
    "桃鬍子海賊團",
    "福連伯斯",
    "巴鐵利拉",
    "邪惡黑組織",
    "磁鼓王國",
    "新聞記者",
    "被害者協會",
    "辛朵莉影子的主人",
    "波音列島",
    "Monsters",
    "獄卒獣",
    "約塔瑪利亞大船團",
    "阿斯卡島",
    "追逐草帽大冒險",
    "撲克牌海賊團",
    "機關島",
    "原惡龍海賊團",
    "新魚人海賊団",
    "艾拉德哥海賊團",
    "王冠島",
    "原洛克斯海賊團",
    "植物學者",
    "ボニー海賊団",
    "スリラーバーク海賊団",
    "黑鬍子海賊團傘下",
    "褐鬍子海賊團",
    "前翻滾海賊團",
    "前BIG MOM海賊團",
    "元B・W",
    "約瑪利亞大船團",
    "宇宙海賊",
    "溫泉島",
    "植物學家",
    "水母海賊團",
    "嘉斯帕德海賊團",
  ];

  const quickKeywords = [
    KEYWORD_MAP.on_play[langCode],
    KEYWORD_MAP.main[langCode],
    KEYWORD_MAP.activate_main[langCode],
    KEYWORD_MAP.once_per_turn[langCode],
    KEYWORD_MAP.when_attacking[langCode],
    KEYWORD_MAP.on_block[langCode],
    KEYWORD_MAP.your_turn[langCode],
    KEYWORD_MAP.end_of_your_turn[langCode],
    KEYWORD_MAP.counter[langCode],
    KEYWORD_MAP.on_your_opponents_attack[langCode],
    KEYWORD_MAP.opponents_turn[langCode],
    KEYWORD_MAP.on_ko[langCode],
    KEYWORD_MAP.trigger[langCode],
    KEYWORD_MAP.rush[langCode],
    KEYWORD_MAP.rush_character[langCode],
    KEYWORD_MAP.blocker[langCode],
    KEYWORD_MAP.unblockable[langCode],
    KEYWORD_MAP.double_attack[langCode],
    KEYWORD_MAP.banish[langCode],
    langCode === "en" ? "No Effect" : "沒有效果",
  ];

  const colorMap = {
    red: t("colors.red"),
    green: t("colors.green"),
    blue: t("colors.blue"),
    purple: t("colors.purple"),
    black: t("colors.black"),
    yellow: t("colors.yellow"),
  };

  const categoryMap = {
    leader: t("categories.leader"),
    character: t("categories.character"),
    event: t("categories.event"),
    stage: t("categories.stage"),
  };

  const rarityMap = {
    leader: t("rarities.leader"),
    common: t("rarities.common"),
    uncommon: t("rarities.uncommon"),
    rare: t("rarities.rare"),
    super_rare: t("rarities.super_rare"),
    secret_rare: t("rarities.secret_rare"),
    special: t("rarities.special"),
  };

  const attributeMap = {
    strike: t("attributes.strike"),
    slash: t("attributes.slash"),
    special: t("attributes.special"),
    ranged: t("attributes.ranged"),
    wisdom: t("attributes.wisdom"),
  };

  const DB_MAP = {
    // Database Value : Base Programming ID
    紅色: "red",
    綠色: "green",
    藍色: "blue",
    紫色: "purple",
    黑色: "black",
    黃色: "yellow",
    領航卡: "leader",
    角色卡: "character",
    事件卡: "event",
    舞台卡: "stage",
    打: "strike",
    斬: "slash",
    特: "special",
    射: "ranged",
    知: "wisdom",
  };

  const sortedPackList = useMemo(() => {
    return packOrder
      .map((code) => {
        const pack = packData[code];

        // 1. Try to find data in the current language (e.g., 'en' or 'zh')
        const currentLangData = pack?.[langCode];

        // 2. Try to find data in Japanese as a fallback (since you're in Japan!)
        const jaData = pack?.["ja"] || pack?.["zh"];

        // 3. Extract the name, trying multiple possible keys
        const packTitle =
          currentLangData?.name ||
          currentLangData?.title ||
          jaData?.name ||
          jaData?.title ||
          code; // Last resort fallback

        return {
          code: code,
          id: String(currentLangData?.id || jaData?.id),
          title: packTitle,
        };
      })
      .filter((p) => p.id && p.id !== "undefined");
  }, [langCode, packData, packOrder]);

  const packByNumericId = useMemo(() => {
    const map = {};
    Object.values(packData).forEach((pack) => {
      ["en", "zh", "ja"].forEach((lang) => {
        if (pack[lang]?.id) {
          const title =
            pack[langCode]?.title ||
            pack["zh"]?.title ||
            pack["ja"]?.title ||
            pack["en"]?.title;
          map[String(pack[lang].id)] = title;
        }
      });
    });
    return map;
  }, [langCode]);

  const resetFilters = () => {
    setSearchTerm(defaultFilters.searchTerm);
    setSelectedKeywords(defaultFilters.selectedKeywords);
    setIsExcludeMode(defaultFilters.isExcludeMode);
    setSelectedColors(defaultFilters.selectedColors);
    setSelectedCosts([]);
    setSelectedRarity(defaultFilters.selectedRarity);
    setFilterCategory(defaultFilters.filterCategory);
    setFilterType1(defaultFilters.filterType1);
    setFilterType2(defaultFilters.filterType2);
    setTypeLogic(defaultFilters.typeLogic);
    setFilterPackId(langCode === "en" ? "556116" : defaultFilters.filterPackId);
    setHideReprint(defaultFilters.hideReprint);
    setHidePromo(defaultFilters.hidePromo);
    setShowCurve(defaultFilters.showCurve);
    setSelectedBlocks(defaultFilters.selectedBlocks);

    // Optional: also clear selected card detail view if you want full reset
    // setSelectedCard(null);
  };

  useEffect(() => {
    if (filterPackId === "all") return;
    const matchingPack = Object.values(packData).find((pack) =>
      ["en", "zh", "ja"].some((lang) => pack[lang]?.id === filterPackId),
    );
    const newId = matchingPack?.[langCode]?.id;
    if (newId && newId !== filterPackId) {
      setFilterPackId(newId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langCode]);

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
    const cardsRef = collection(
      db,
      "artifacts",
      appId,
      "public",
      "data",
      "cards",
    );
    const unsubscribe = onSnapshot(
      cardsRef,
      (snapshot) => {
        const cardData = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        }));
        setCards(cardData);
        setIsCardsLoading(false);
      },
      (err) => {
        console.error("Firestore error:", err);
        setCardsError(err.message || "Failed to load cards.");
        setIsCardsLoading(false);
      },
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    setIsImportingDeck(false);
    // Optional: also clear the input
    setDeckInput("");
  }, [appMode]);

  useEffect(() => {
    setFilterType1("all");
    setFilterType2("all");
  }, [langCode]);

  const overlaidCards = useMemo(() => {
    if (langCode !== "en") return cards;
    return cards.map((c) => {
      const en = enCardsData[c.id];
      if (!en) return c;
      return {
        ...c,
        name: en.name,
        effect: en.effect,
        types: en.types,
        trigger: en.trigger,
        pack_id: en.pack_id,
      };
    });
  }, [cards, langCode]);

  const displayCard = useMemo(
    () =>
      selectedCard
        ? (overlaidCards.find((c) => c.id === selectedCard.id) ?? selectedCard)
        : null,
    [selectedCard, overlaidCards],
  );

  useEffect(() => {
    // 1. Get IDs of all cards currently in the deckList
    const cardIdsInDeck = Object.keys(deckList);

    // 2. Look through the cards data to find which one is the Leader
    const leaderCard = overlaidCards.find(
      (card) => cardIdsInDeck.includes(card.id) && card.category === "Leader",
    );

    // 3. Debugging (Optional: Remove this once it works)
    if (leaderCard) {
      console.log("Found Leader:", leaderCard.name, leaderCard.id);
    }

    // 4. Update the visual state
    setSelectedLeader(leaderCard || null);
  }, [deckList, overlaidCards]);

  useEffect(() => {
    // 1. Instead of fetching, we look at the IDs inside your top_decks.json
    const leaderIds = Object.keys(topDecksData);

    if (leaderIds.length > 0) {
      console.log(
        `Successfully loaded ${leaderIds.length} Meta Leaders from static data.`,
      );

      // 2. We create a simulated stats object.
      // Since we don't have the real 'counts' from the DB anymore,
      // we assign a default count (like 1) so the UI logic still works.
      const staticStats = {};
      leaderIds.forEach((id) => {
        // Use the ID as the key, standardized to Uppercase
        staticStats[id.toUpperCase()] = 1;
      });

      setLeaderStats(staticStats);
    } else {
      console.warn("No leader data found in top_decks.json");
    }
  }, []);

  const getBaseIdCount = useCallback(
    (cardId) => {
      const baseId = getBaseId(cardId);
      // Determine which list to scan based on the current mode
      const currentList = isMarketMode ? marketList : deckList;

      return Object.entries(currentList).reduce((total, [id, count]) => {
        return getBaseId(id) === baseId ? total + count : total;
      }, 0);
    },
    [isMarketMode, marketList, deckList], // Added isMarketMode and marketList
  );

  const generateShareUrl = () => {
    const entries = Object.entries(deckList).filter(([_, count]) => count > 0);
    if (entries.length === 0) return alert("牌組是空的！");

    try {
      // 1. Format the deck cards (4xOP01-001,1xOP01-002)
      const deckString = entries
        .map(([id, count]) => `${count}x${id}`)
        .join(",");

      // 2. Play Curve Serialization
      // Updated to match your useEffect's .split(",") and .split(":") logic
      const serializeCurve = (curve) => {
        return curve
          .map((turn) => {
            // Use 'none' for null slots as expected by your deserializeCurve
            const slotsPart = turn.slots.map((s) => s || "none").join("|");
            const opsPart = turn.operators.join("|");
            return `${slotsPart}:${opsPart}`;
          })
          .join(","); // Use comma to separate turns
      };

      const fullData = {
        d: deckString,
        c1: serializeCurve(firstCurveTurns),
        c2: serializeCurve(secondCurveTurns),
      };

      // 3. Encode the JSON string
      const encodedData = btoa(encodeURIComponent(JSON.stringify(fullData)));

      // 4. Using 'deckData' triggers CASE 1 in your useEffect, which runs setAppMode("DECK")
      const shareUrl = `${window.location.origin}${window.location.pathname}?deckData=${encodedData}`;

      navigator.clipboard.writeText(shareUrl).then(() => {
        alert("牌組策略連結已複製！開啟後將進入牌組模式。");
      });
    } catch (e) {
      console.error("Share Error:", e);
      alert("分享失敗，請縮減牌組或曲線內容。");
    }
  };

  const generateMarketShareUrl = () => {
    // 1. Determine which source of truth to share
    const activeList = isMarketMode ? marketList : deckList;
    const entries = Object.entries(activeList || {}).filter(
      ([_, count]) => count > 0,
    );

    if (entries.length === 0) {
      return alert(isMarketMode ? "市場清單是空的！" : "牌組清單是空的！");
    }

    try {
      // 2. Format the card quantities (e.g., "4xOP01-001,2xOP01-016")
      const deckString = entries
        .map(([id, count]) => `${count}x${id}`)
        .join(",");

      /* 3. Capture the Price/Note Data
       We only want to share prices for cards that are actually in the current list
       to keep the URL length manageable.
    */
      const relevantMarketData = {};
      entries.forEach(([id]) => {
        if (marketData[id]) {
          relevantMarketData[id] = marketData[id];
        }
      });

      // 4. Build the payload
      // 'd' = deck/list string
      // 'm' = market/price data
      const shareObj = {
        d: deckString,
        m: relevantMarketData,
      };

      // 5. Encode the payload
      const jsonString = JSON.stringify(shareObj);
      const encodedData = btoa(encodeURIComponent(jsonString));

      // 6. Generate the URL
      // We use 'marketData' as the param to trigger the Marketplace view on load
      const shareUrl = `${window.location.origin}${window.location.pathname}?marketData=${encodedData}`;

      navigator.clipboard.writeText(shareUrl).then(() => {
        const modeName = isMarketMode ? "市場清單" : "牌組報價";
        alert(`${modeName}連結已複製！開啟連結將包含您輸入的價格。`);
      });
    } catch (err) {
      console.error("Share Error:", err);
      alert("生成連結失敗。");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deckDataParam = params.get("deckData");
    const marketDataParam = params.get("marketData");

    // --- PHASE 1: IMMEDIATE UI SWITCHING ---
    // We switch the view mode immediately so the user doesn't see "Search"
    // while the data is still loading.
    if (deckDataParam) {
      setAppMode("DECK");
    } else if (marketDataParam) {
      setAppMode("MARKETPLACE");
    }

    // --- PHASE 2: DATA LOADING GUARD ---
    // If cards (Firebase/JSON) aren't loaded yet, we stop here.
    // The UI is already switched, and this effect will run again once 'cards' fills up.
    if (!cards || cards.length === 0) return;

    // Helper to turn "4xOP01-001,1xOP01-002" into { "OP01-001": 4, ... }
    // Updated Helper inside your useEffect
    const importDeckList = (deckStr, targetMode = "DECK") => {
      const newList = {};
      deckStr.split(",").forEach((pair) => {
        const [count, id] = pair.split("x");
        if (id && count) {
          newList[id] = parseInt(count, 10);
        }
      });

      // Use the specific targetMode passed in
      if (targetMode === "MARKETPLACE") {
        setMarketList(newList);
        setIsMarketMode(true); // Automatically flip the toggle to Market
      } else {
        setDeckList(newList);
        setIsMarketMode(false); // Ensure we are in Deck mode rules
      }
    };

    // Helper to turn serialized curve strings back into the objects your UI uses
    const deserializeCurve = (str, defaults) => {
      if (!str)
        return defaults.map((don) => ({
          don,
          slots: Array(5).fill(null),
          operators: Array(4).fill("or"),
        }));

      return str.split(",").map((turnStr, i) => {
        const [slotsPart, opsPart] = turnStr.split(":");
        let slots = slotsPart.split("|").map((s) => (s === "none" ? null : s));
        while (slots.length < 5) slots.push(null);
        let ops = opsPart ? opsPart.split("|") : [];
        while (ops.length < 4) ops.push("or");

        return {
          don: defaults[i],
          slots: slots.slice(0, 5),
          operators: ops.slice(0, 4),
        };
      });
    };

    try {
      // --- CASE 1: DECK MODE IMPORT ---
      if (deckDataParam) {
        const decoded = JSON.parse(decodeURIComponent(atob(deckDataParam)));

        if (decoded.d) importDeckList(decoded.d, "DECK");

        if (decoded.c1)
          setFirstCurveTurns(deserializeCurve(decoded.c1, [1, 3, 5, 7, 9]));
        if (decoded.c2)
          setSecondCurveTurns(deserializeCurve(decoded.c2, [2, 4, 6, 8, 10]));
      }

      // --- CASE 2: MARKETPLACE MODE IMPORT ---
      if (marketDataParam) {
        const decoded = JSON.parse(decodeURIComponent(atob(marketDataParam)));

        // 1. Import the card list (Quantities x ID)
        if (decoded.d) {
          importDeckList(decoded.d, "MARKETPLACE");
        }

        // 2. Import the Price/Market Data (Direct Object Merge)
        if (decoded.m) {
          /* We merge the incoming shared data with your existing local storage data.
       This ensures if you share 5 cards, but have 100 prices saved locally,
       you don't lose your other 95 prices.
    */
          setMarketData((prev) => ({
            ...prev,
            ...decoded.m,
          }));
        }

        // Ensure we switch to the right view
        setAppMode("MARKETPLACE");
        setIsMarketMode(true);
      }

      // --- PHASE 3: URL CLEANUP ---
      // Only clean up the URL once we have successfully processed the data.
      if (deckDataParam || marketDataParam) {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );
      }
    } catch (error) {
      console.error("Link Import Error:", error);
    }
  }, [cards, setDeckList, setAppMode]); // Added dependencies for stability

  const updateDeckCount = useCallback(
    (card, delta) => {
      if (!card || !card.id) return;

      // Pick the setter based on the mode
      const setTargetList = isMarketMode ? setMarketList : setDeckList;

      setTargetList((prev) => {
        const currentCount = prev[card.id] || 0;
        const newCount = currentCount + delta;

        // REMOVAL: Always allowed until 0
        if (delta < 0) {
          if (newCount <= 0) {
            const newState = { ...prev };
            delete newState[card.id];
            return newState;
          }
          return { ...prev, [card.id]: newCount };
        }

        // ADDITION: Market Mode has no restrictions
        if (isMarketMode) {
          return { ...prev, [card.id]: newCount };
        }

        // ADDITION: Deck Mode Strict Rules
        if (card.category === "Leader") {
          const newState = { ...prev };
          Object.keys(newState).forEach((id) => {
            const c = cards.find((item) => item.id === id);
            if (c && c.category === "Leader") delete newState[id];
          });
          newState[card.id] = 1;
          return newState;
        }

        // Check count using our new mode-aware helper
        if (
          !UNLIMITED_COPIES.includes(getBaseId(card.id)) &&
          getBaseIdCount(card.id) >= 4
        )
          return prev;

        return { ...prev, [card.id]: newCount };
      });
    },
    [isMarketMode, setMarketList, setDeckList, cards, getBaseIdCount],
  );

  const deckAnalysis = useMemo(() => {
    const deckEntries = Object.entries(deckList)
      .map(([id, count]) => ({
        card: overlaidCards.find((c) => c.id === id),
        count,
      }))
      .filter((item) => item.card && item.card.category !== "Leader");

    const totalNonLeader = deckEntries.reduce(
      (acc, curr) => acc + curr.count,
      0,
    );
    if (totalNonLeader === 0) return null;

    const costs = Array(11).fill(0);
    const costs_cards = Array.from({ length: 11 }, () => []);

    deckEntries.forEach((item) => {
      // 1. If item.card.cost is null, treat it as "0"
      // 2. Using the ?? (nullish coalescing) operator is the cleanest way
      const rawCost = item.card.cost ?? "0";

      const c = parseInt(rawCost, 10);

      if (!isNaN(c)) {
        // Math.max/min ensures we stay within the 0-10 index range
        const index = Math.min(Math.max(c, 0), 10);
        costs[index] += item.count;
        costs_cards[index].push({ id: item.card.id, name: item.card.name, count: item.count });
      }
    });

    const categories = { Character: 0, Event: 0, Stage: 0 };
    deckEntries.forEach((item) => {
      if (categories[item.card.category] !== undefined) {
        categories[item.card.category] += item.count;
      }
    });

    const counters = {
      0: 0,
      1000: 0,
      2000: 0,
      "0_cards": [],
      "1000_cards": [],
      "2000_cards": [],
    };
    deckEntries.forEach((item) => {
      const cntVal = parseInt(item.card.counter);
      const key = isNaN(cntVal) || cntVal === 0 ? "0" : String(cntVal);
      if (counters[key] !== undefined) {
        counters[key] += item.count;
        counters[`${key}_cards`].push({
          id: item.card.id,
          name: item.card.name,
          count: item.count,
        });
      } else {
        counters["0"] += item.count;
        counters["0_cards"].push({
          id: item.card.id,
          name: item.card.name,
          count: item.count,
        });
      }
    });

    // NEW: Calculate Weighted Average
    const totalCounterValue = counters["1000"] * 1000 + counters["2000"] * 2000;
    const avgCounter = Math.round(totalCounterValue / totalNonLeader);
    const twokCounter = Math.round((counters["2000"] / totalNonLeader) * 100);
    // NEW: Calculate Quality Score (Percentage of cards with +1000 or +2000)
    const cardsWithCounter = counters["1000"] + counters["2000"];
    const counterQualityScore = Math.round(
      (cardsWithCounter / totalNonLeader) * 100,
    );

    const typesMap = {};
    deckEntries.forEach((item) => {
      item.card.types?.forEach((t) => {
        if (!typesMap[t]) {
          typesMap[t] = { count: 0, cards: [] };
        }
        typesMap[t].count += item.count;
        // Store the card and its count for the hover list
        typesMap[t].cards.push({
          id: item.card.id,
          name: item.card.name,
          count: item.count,
        });
      });
    });

    // Change the sort comparison from b[1].count to b[1].cards.length
    const sortedTypes = Object.entries(typesMap).sort((a, b) => {
      // 1. Primary sort: Number of unique card types (descending)
      const diff = b[1].cards.length - a[1].cards.length;

      // 2. Secondary sort: If lengths are equal, sort by total quantity (descending)
      if (diff === 0) return b[1].count - a[1].count;

      return diff;
    });

    let blockerCount = 0;

    deckEntries.forEach((item) => {
      const effect = item.card.effect || "";

      // Regular Expression Explanation:
      // ^【防禦】          -> Matches if it starts with the keyword
      // |                 -> OR
      // <br>【防禦】       -> Matches if it follows a line break
      const isTrueBlocker = /^【防禦】|<br>【防禦】/.test(effect);

      if (isTrueBlocker) {
        blockerCount += item.count;
      }
    });

    return {
      costs,
      costs_cards,
      categories,
      counters,
      avgCounter,
      twokCounter,
      counterQualityScore,
      sortedTypes,
      totalNonLeader,
      blockerCount,
    };
  }, [deckList, overlaidCards]);

  const [hoveredTrait, setHoveredTrait] = useState(null);

  const toggleKeyword = (keyword) => {
    setSelectedKeywords((prev) =>
      prev.includes(keyword)
        ? prev.filter((k) => k !== keyword)
        : [...prev, keyword],
    );
  };

  const toggleColor = (color) => {
    if (color === "所有") {
      setSelectedColors([]);
      return;
    }
    setSelectedColors((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  };

  // Add these inside your App component logic
  const toggleRarity = (rarityId) => {
    setSelectedRarity((prev) =>
      prev.includes(rarityId)
        ? prev.filter((r) => r !== rarityId)
        : [...prev.filter((r) => r !== "all"), rarityId],
    );
  };

  const toggleAttribute = (attributeId) => {
    setSelectedAttributes((prev) =>
      prev.includes(attributeId)
        ? prev.filter((a) => a !== attributeId)
        : [...prev.filter((a) => a !== "all"), attributeId],
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
        await setDoc(
          doc(db, "artifacts", appId, "public", "data", "cards", card.id),
          card,
        );
      }
      setJsonInput("");
      setIsImporting(false);
      alert("Upload Successful!"); // <--- Add this
    } catch (err) {
      console.error("Import error:", err);
      setIsImporting(false);
      alert("Upload Failed: " + err.message); // <--- Add this
    }
  };

  const handleImportDeckCode = (importText = null) => {
    const isEvent =
      importText && typeof importText === "object" && importText.target;
    const textToProcess = isEvent || !importText ? deckInput : importText;

    if (!textToProcess || typeof textToProcess !== "string") return;

    const lines = textToProcess.split(/[\n,]/);
    const newImportedData = {};

    lines.forEach((line) => {
      const match = line.trim().match(/^(\d+)x(.+)$/);
      if (match) {
        const count = parseInt(match[1], 10);
        const cardId = match[2].trim();
        newImportedData[cardId] = (newImportedData[cardId] || 0) + count;
      }
    });

    // TARGET THE CORRECT LIST
    if (isMarketMode) {
      setMarketList(newImportedData); // Allows any number of cards/leaders
    } else {
      setDeckList(newImportedData); // Subject to your 1+50 validation elsewhere
    }

    setIsImportingDeck(false);
    setDeckInput("");
  };

  const parseNumericFilter = (term) => {
    const match = term.match(/^([><]=?|=)?(\d+)$/);
    return match
      ? { operator: match[1] || "=", value: parseInt(match[2], 10) }
      : null;
  };

  const compare = (cardValue, filter) => {
    const val = parseInt(cardValue, 10);
    if (isNaN(val)) return false;
    switch (filter.operator) {
      case ">":
        return val > filter.value;
      case "<":
        return val < filter.value;
      case ">=":
        return val >= filter.value;
      case "<=":
        return val <= filter.value;
      case "=":
        return val === filter.value;
      default:
        return val === filter.value;
    }
  };

  const filteredCards = useMemo(() => {
    const conditions = searchTerm.split(/[,，]/).filter((c) => c.trim() !== "");

    return overlaidCards.filter((card) => {
      // --- 1. ID Filtering (Remains the same as IDs are universal) ---
      if (hideReprint && card.id && /_r\d+$/i.test(card.id)) return false;
      if (hidePromo && card.id && /_p\d+$/i.test(card.id)) return false;

      // --- 2. Search Bar Logic ---
      const matchesSearch = conditions.every((cond) => {
        const term = cond.toLowerCase().trim();

        // Counter Search (+1000)
        const counterMatch = term.match(/^\+(\d+)$/);
        if (counterMatch) {
          const targetCounter = parseInt(counterMatch[1], 10);
          const cardCounter = parseInt(card.counter || 0, 10);
          return cardCounter === targetCounter;
        }

        // Numeric Filters (Cost/Power)
        const nf = parseNumericFilter(term);
        if (term === "0")
          return card.counter === 0 || card.cost === 0 || card.power === 0;
        if (nf) {
          if (nf.value <= 15) return compare(card.cost, nf);
          return compare(card.power, nf);
        }

        // Text Search (Name, ID, Effect, Types)
        return (
          (card.name || "").toLowerCase().includes(term) ||
          (card.id || "").toLowerCase().includes(term) ||
          (card.effect || "").toLowerCase().includes(term) ||
          (card.types && card.types.some((t) => t.toLowerCase().includes(term)))
        );
      });

      // --- 3. Keyword Filtering (The "No Effect" Future-proofing) ---
      const matchesKeywords =
        selectedKeywords.length === 0
          ? true
          : (() => {
              return selectedKeywords.every((k) => {
                // Find the specific keyword object from your KEYWORD_MAP
                // We look for the keyword that matches the current UI label
                const kwObj = Object.values(KEYWORD_MAP).find(
                  (val) => val[langCode] === k,
                );
                const searchString = kwObj ? kwObj[langCode] : k;

                // Special Case: No Effect
                if (k === "沒有效果" || k === "No Effect") {
                  const isNoEffect =
                    card.effect === "-" && card.trigger === null;
                  return isExcludeMode ? !isNoEffect : isNoEffect;
                }

                const hasKeyword =
                  (card.effect || "").includes(searchString) ||
                  (card.trigger || "").includes(searchString);

                return isExcludeMode ? !hasKeyword : hasKeyword;
              });
            })();

      // --- 4. Color Filtering ---
      let matchesColor = true;
      if (selectedColors.length > 0) {
        matchesColor = selectedColors.some((selected) => {
          if (selected === "multi") return (card.colors?.length || 0) > 1;
          // JSON: ["Red"] -> compare "red" vs state "red"
          return card.colors?.some(
            (c) => c.toLowerCase() === selected.toLowerCase(),
          );
        });
      }

      // --- 5. Rarity & Category ---
      const RARITY_KEY_TO_DB = {
        special: "sp卡",
        super_rare: "super rare",
        secret_rare: "secret rare",
      };
      const matchesRarity =
        selectedRarity.length === 0 ||
        selectedRarity.some((r) => {
          const dbVal = RARITY_KEY_TO_DB[r] ?? r.toLowerCase();
          return card.rarity?.toLowerCase() === dbVal;
        });

      // Convert card.category (e.g., "角色卡") to "character" using DB_MAP
      // --- 5. Category Filtering ---
      const matchesCategory =
        filterCategory === "all" ||
        filterCategory === "所有" ||
        card.category?.toLowerCase() === filterCategory.toLowerCase();

      // --- 6. Type/Trait Filtering (Direct matching as these are usually specific names) ---
      let matchesType = true;
      const type1Active = filterType1 !== "all" && filterType1 !== "所有";
      const type2Active = filterType2 !== "all" && filterType2 !== "所有";

      if (type1Active && type2Active) {
        const hasT1 = card.types?.includes(filterType1);
        const hasT2 = card.types?.includes(filterType2);
        matchesType = typeLogic === "AND" ? hasT1 && hasT2 : hasT1 || hasT2;
      } else if (type1Active) {
        matchesType = card.types?.includes(filterType1);
      } else if (type2Active) {
        matchesType = card.types?.includes(filterType2);
      }

      // --- 7. Pack Filtering ---
      const matchesPack =
        filterPackId === "all" ||
        filterPackId === "所有" ||
        String(card.pack_id) === String(filterPackId);

      // --- 8. Attribute Filtering ---
      // Convert card.attributes (e.g., "斬") to "slash" using DB_MAP
      const matchesAttribute =
        selectedAttributes.length === 0 ||
        card.attributes?.some((attr) =>
          selectedAttributes.includes(attr.toLowerCase()),
        );

      // --- 9. Block Filtering ---
      const matchesBlock =
        selectedBlocks.length === 0 ||
        selectedBlocks.includes("all") ||
        selectedBlocks.some((block) => {
          if (block === "1_legal") {
            return (
              card.block_number === 1 && BLOCK_1_EXCEPTIONS.includes(card.id)
            );
          }
          return card.block_number === parseInt(block, 10);
        });

      // Cost Filter Logic
      const matchesCost =
        selectedCosts.length === 0 || selectedCosts.includes(Number(card.cost));

      return (
        matchesSearch &&
        matchesKeywords &&
        matchesColor &&
        matchesCost &&
        matchesRarity &&
        matchesCategory &&
        matchesType &&
        matchesPack &&
        matchesAttribute &&
        matchesBlock
      );
    });
  }, [
    cards,
    searchTerm,
    selectedKeywords,
    isExcludeMode,
    selectedColors,
    selectedCosts,
    selectedRarity,
    filterCategory,
    filterType1,
    filterType2,
    typeLogic,
    filterPackId,
    hideReprint,
    hidePromo,
    selectedAttributes,
    selectedBlocks,
    overlaidCards,
  ]);

  const legalityWarning = useMemo(() => {
    if (!cards || !deckList)
      return {
        hasIssue: false,
        messages: [],
        illegalIds: [],
        missingIds: [],
        colorMismatchedIds: [],
      };

    const isMarketActive =
      Object.keys(marketData || {}).length > 0 && isMarketMode;
    const dataSource = isMarketActive ? marketData : deckList;

    const leaderId = Object.keys(dataSource)
      .find((id) => {
        const baseId = id.split("_")[0];
        const cardData = cards.find((c) => c.id === baseId);
        // 根據你的樣本，欄位名稱是 category
        return cardData?.category === "Leader";
      })
      ?.split("_")[0];

    const leader = cards.find((c) => c.id === leaderId);

    const activeEntries = Object.entries(dataSource).filter(([_, val]) => {
      const count = typeof val === "object" ? val.count : val;
      return count > 0;
    });

    const activeIds = activeEntries.map(([id]) => id.split("_")[0]);
    const messages = [];
    const illegalIds = [];
    const missingIds = [];

    // 1. Check for Missing Data
    activeIds.forEach((baseId) => {
      if (!cards.some((c) => c.id === baseId)) {
        missingIds.push(baseId);
      }
    });

    if (missingIds.length > 0) {
      messages.push(`找不到卡牌資料: ${missingIds.join(", ")}`);
    }

    // 2. Check Block 1
    const blockOneCount = activeEntries
      .filter(([id, val]) => {
        const baseId = id.split("_")[0];
        const cardData = cards.find((c) => c.id === baseId);
        const isIllegal =
          cardData?.block_number === 1 && !BLOCK_1_EXCEPTIONS.includes(baseId);
        if (isIllegal) illegalIds.push(baseId);
        return isIllegal;
      })
      .reduce((acc, [_, val]) => {
        const count = typeof val === "object" ? val.count : val;
        return acc + count;
      }, 0);

    if (blockOneCount > 0)
      messages.push(`包含 ${blockOneCount} 張擴張記號①卡牌。`);

    // 3. Check Banned List
    const bannedInList = activeIds.filter((id) => BANNED_LIST.includes(id));
    if (bannedInList.length > 0) {
      messages.push(`禁止卡牌: ${bannedInList.join(", ")}`);
      illegalIds.push(...bannedInList);
    }

    // 4. Check Pairs (Only relevant for Deck Mode usually)
    if (!isMarketActive) {
      RESTRICTED_PAIRS.forEach(([cardA, cardB]) => {
        if (activeIds.includes(cardA) && activeIds.includes(cardB)) {
          messages.push(`禁止組合: ${cardA} 與 ${cardB}`);
          illegalIds.push(cardA, cardB);
        }
      });
    }

    const colorMismatchedIds = [];

    // 5. Check Color Identity (Only in Deck Mode)
    if (!isMarketActive && leader) {
      // 根據樣本，leader.colors 已經是 ["Red", "Green"]
      const leaderColors = Array.isArray(leader.colors)
        ? leader.colors
        : (leader.colors || "").split("/");

      activeEntries.forEach(([id, _]) => {
        const baseId = id.split("_")[0];
        const cardData = cards.find((c) => c.id === baseId);

        // 排除 Leader 本身，並檢查其顏色
        if (cardData && cardData.category !== "Leader" && cardData.colors) {
          const cardColors = Array.isArray(cardData.colors)
            ? cardData.colors
            : cardData.colors.split("/");

          // 檢查：這張卡片是否包含任何「不屬於」Leader 顏色的顏色
          // 使用 .some(c => !leaderColors.includes(c)) 更精確
          const isMismatched = cardColors.some(
            (c) =>
              !leaderColors.some(
                (lc) => lc.trim().toLowerCase() === c.trim().toLowerCase(),
              ),
          );

          if (isMismatched) {
            colorMismatchedIds.push(baseId);
          }
        }
      });
    }

    return {
      hasIssue:
        messages.length > 0 ||
        missingIds.length > 0 ||
        colorMismatchedIds.length > 0,
      messages,
      illegalIds: [...new Set(illegalIds)],
      missingIds: [...new Set(missingIds)],
      colorMismatchedIds: [...new Set(colorMismatchedIds)],
    };
  }, [deckList, marketData, cards, isMarketMode]); // Note: 'leader' removed from deps since it's derived now

  const dataIntegrityWarning = useMemo(() => {
    // 1. Determine which list we are currently auditing
    // (Match this to whatever state variable controls your View Mode)
    const dataSource = isMarketMode ? marketList : deckList;

    if (!dataSource || !cards || cards.length === 0) {
      return { hasIssue: false, missingData: [], missingPrices: [] };
    }

    const missingData = [];
    const missingPrices = [];

    // 2. Audit the ACTIVE data source
    Object.entries(dataSource).forEach(([id, count]) => {
      if (count <= 0) return;

      const baseId = id.split("_")[0].toUpperCase();
      const cardData = cards.find((c) => c.id.toUpperCase() === baseId);

      // If the card doesn't exist in the DB, it's a critical data issue
      if (!cardData) {
        missingData.push(id);
      } else {
        // If it exists in DB, check if the user has provided a price in marketData
        const priceValue = marketData[id]?.price;
        const isPriceEmpty = !priceValue || String(priceValue).trim() === "";

        if (isPriceEmpty) {
          missingPrices.push(id);
        }
      }
    });

    return {
      hasIssue: missingData.length > 0 || missingPrices.length > 0,
      missingData,
      missingPrices,
    };
    // 3. Ensure all relevant states are in the dependency array
  }, [isMarketMode, marketList, deckList, cards, marketData]);

  // DECK CARDS (ONLY THOSE IN DECKLIST)
  const deckBuildingCards = useMemo(() => {
    return Object.entries(deckList)
      .filter(([id, count]) => count > 0)
      .map(([id, count]) => {
        const baseId = id.split("_")[0];
        const baseInfo = cards.find((c) => c.id === baseId);
        const marketInfo = marketData.prices?.find((p) => p.id === id);

        return {
          ...baseInfo,
          ...marketInfo,
          id: id, // Ensures the ID is the specific one (e.g., _p1)
        };
      })
      .filter((c) => !!c.name); // Final check to ensure card data was found
  }, [deckList, cards, marketData]);

  const deckValuation = useMemo(() => {
    let totalHKD = 0;
    let totalJPY = 0;
    let missingCount = 0; // Track missing prices

    Object.entries(activeList).forEach(([id, count]) => {
      if (count <= 0) return;

      const priceEntry = marketData[id];

      // Check if price exists and is non-zero
      const unitHKD = priceEntry
        ? parseFloat(priceEntry.price) || parseFloat(priceEntry.hkd) || 0
        : 0;
      const unitJPY = priceEntry ? parseFloat(priceEntry.jpy) || 0 : 0;

      if (unitHKD === 0) {
        missingCount += 1; // Increment if no price found
      }

      totalHKD += unitHKD * count;
      totalJPY += unitJPY * count;
    });

    return {
      totalHKD,
      totalJPY,
      missingCount, // Return this for the UI
    };
  }, [activeList, marketData]);

  const deckTableData = useMemo(() => {
    // 1. Determine source of truth
    const activeList = isMarketMode ? marketList : deckList;

    if (!activeList || !cards) return [];

    return Object.entries(activeList)
      .filter(([_, count]) => count > 0)
      .map(([id, quantity]) => {
        const baseId = id.split("_")[0];
        const cardBase = cards.find((c) => c.id === baseId) || {};
        const priceEntry = marketData[id] || {};

        const unitPrice =
          parseFloat(priceEntry.price) || parseFloat(priceEntry.hkd) || 0;
        const totalPrice = unitPrice * quantity;

        return {
          id,
          name: cardBase.name || "Unknown Card",
          category: cardBase.category || "Unknown", // "Leader", "Character", etc.
          quantity,
          unitPrice,
          totalPrice,
        };
      })
      .sort((a, b) => {
        // 2. ONLY prioritize the Leader
        const isALeader = a.category === "Leader";
        const isBLeader = b.category === "Leader";

        if (isALeader && !isBLeader) return -1;
        if (!isALeader && isBLeader) return 1;

        // 3. For everything else, return 0 to keep the original import order
        return 0;
      });
  }, [isMarketMode, marketList, deckList, cards, marketData]);

  const copySimFormat = () => {
    if (!deckTableData || deckTableData.length === 0) return;

    // Format: Quantity x ID (e.g., 4xOP15-001), one per line
    const simString = deckTableData
      .map((item) => `${item.quantity}x${item.id}`)
      .join("\n");

    navigator.clipboard.writeText(simString).then(() => {
      // Optional: Visual feedback
      alert(t("copied_to_sim", "已複製到剪貼簿 (4xOP01-001)"));
    });
  };

  // NAVIGATION LOGIC FOR MODAL
  const activeCardsList = useMemo(() => {
    if (appMode === "MARKETPLACE") {
      // Map the IDs from your table back to full card objects
      // to ensure navigateCard can find the current ID
      return deckTableData.map((item) => {
        const baseInfo =
          cards.find((c) => c.id === item.id.split("_")[0]) || {};
        const marketInfo =
          marketData.prices?.find((p) => p.id === item.id) || {};
        return { ...baseInfo, ...marketInfo, id: item.id };
      });
    }
    return appMode === "DECK" ? deckBuildingCards : filteredCards;
  }, [
    appMode,
    deckTableData,
    deckBuildingCards,
    filteredCards,
    cards,
    marketData,
  ]);

  const navigateCard = useCallback(
    (direction) => {
      if (!selectedCard) return;
      const currentIndex = activeCardsList.findIndex(
        (c) => c.id === selectedCard.id,
      );
      if (currentIndex === -1) return;

      let nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = activeCardsList.length - 1;
      if (nextIndex >= activeCardsList.length) nextIndex = 0;

      setSelectedCard(activeCardsList[nextIndex]);
    },
    [selectedCard, activeCardsList],
  );

  // Note: cycle throuhgh all versions of cards in database
  const cycleParallel = useCallback(
    (direction) => {
      if (!selectedCard || !cards) return;

      // 1. Get the Base ID (e.g., "ST02-007")
      const baseId = selectedCard.id.split("_")[0];

      // 2. Filter: Only base cards or suffixes starting with 'P'
      const versions = cards
        .filter((c) => {
          if (!c.id || !String(c.id).startsWith(baseId)) return false;

          const parts = c.id.split("_");
          // If no underscore, it's the base card (e.g., "ST02-007")
          if (parts.length === 1) return true;

          // If there's a suffix, only keep it if it starts with 'P'
          const suffix = parts[1].toLowerCase();
          return suffix.startsWith("p");
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      if (versions.length <= 1) return;

      // 3. Find where we are currently
      const currentIndex = versions.findIndex((v) => v.id === selectedCard.id);

      // 4. Calculate next index (The "Four-Liner")
      const nextIndex =
        (currentIndex + direction + versions.length) % versions.length;
      const nextCard = versions[nextIndex];

      const newId = nextCard.id;
      const oldId = selectedCard.id;

      // 5. Update Deck List
      setDeckList((prev) => {
        const newDeck = { ...prev };
        if (newDeck[oldId]) {
          const currentCount = newDeck[oldId];
          delete newDeck[oldId];
          newDeck[newId] = currentCount;
        }
        return newDeck;
      });

      // 6. Update Modal View
      // We merge the master card info with any price data we have in marketData
      setSelectedCard({
        ...nextCard,
        ...(marketData[newId] || {}), // If no price, this just adds nothing
        id: newId,
      });
    },
    [selectedCard, cards, marketData, setDeckList],
  );

  const bulkUpdateRarity = useCallback(
    (type) => {
      const allPrices = Array.isArray(cardPrices)
        ? cardPrices
        : cardPrices?.prices || [];

      // Determine which setter to use based on mode
      const setter = isMarketMode ? setMarketList : setDeckList;

      setter((prev) => {
        const newList = {};

        Object.entries(prev).forEach(([currentId, count]) => {
          if (count <= 0) return;
          const baseId = String(currentId).split("_")[0];

          if (type === "BASIC") {
            newList[baseId] = (newList[baseId] || 0) + count;
          } else if (type === "MAX") {
            const versions = allPrices
              .filter((p) => p.id && String(p.id).startsWith(baseId))
              .sort((a, b) => {
                const getNum = (fullId) => {
                  const strId = String(fullId);
                  return strId.includes("_p")
                    ? parseInt(strId.split("_p")[1], 10) || 0
                    : 0;
                };
                return getNum(b) - getNum(a);
              });

            const highestId = versions.length > 0 ? versions[0].id : baseId;
            newList[highestId] = (newList[highestId] || 0) + count;
          }
        });
        return newList;
      });
    },
    [isMarketMode, setDeckList, setMarketList, cardPrices], // Added necessary dependencies
  );

  const getHelpContent = () => {
    switch (appMode) {
      case "IMPORT":
        return {
          deck: "請選擇牌組模式。",
          single: "",
        };
      case "DECK":
        return {
          deck: "點擊加減按鈕將會更新您的牌組。",
          single: "點擊加減按鈕將會更新您的單卡清單，而非此處看到的牌組。",
        };
      case "MARKETPLACE":
        return {
          deck: "對牌組進行報價。",
          single: "管理您的收購/出售清單，對單卡進行報價。",
        };
      case "SEARCH":
        return {
          deck: "搜尋卡牌並加入您的牌組。",
          single: "搜尋卡牌並加入單卡報價清單。",
        };

      default:
        return { deck: "牌組", single: "單卡" };
    }
  };

  const help = getHelpContent();

  const renderFormattedEffect = (text) => {
    if (!text) return null;

    // langCode is defined at the top of App() via useTranslation
    const currentLang = langCode;

    // 1. Get ALL keywords for the CURRENT language from your KEYWORD_MAP
    // This creates a list like ["【登場時】", "【速攻】"] or ["[On Play]", "[Rush]"]
    const activeKeywords = rules.flatMap((rule) =>
      rule.ids.map((id) => KEYWORD_MAP[id]?.[currentLang]).filter(Boolean),
    );

    const keywordRegexPart = activeKeywords
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");

    // REFINED REGEX (Same logic as yours, but using activeKeywords)
    const regex = new RegExp(
      `(${keywordRegexPart}|!!|‼|[^\\s\\n【】(]+(?:\\([^)]*\\))?[:：])`,
      "g",
    );

    // English card data stores attribute tags pre-escaped (e.g. "&lt;Slash&gt;").
    // Decode HTML entities so they render as "<Slash>" instead of literal "&lt;Slash&gt;".
    const decodeEntities = (s) =>
      s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, "&");

    const plainText = decodeEntities(text.replace(/<br>/g, "\n"));
    const parts = plainText.split(regex);

    return parts.map((part, index) => {
      if (!part) return null;

      // A. Handle Keyword Boxes
      // We check which rule contains an ID that matches this part in the current language
      const rule = rules.find((r) =>
        r.ids.some((id) => KEYWORD_MAP[id]?.[currentLang] === part),
      );

      if (rule) {
        const subParts = part.split(/(‼|!!)/g);
        return (
          <span key={index} className={rule.style}>
            {subParts.map((sub, i) =>
              sub === "‼" || sub === "!!" ? (
                <span key={i} className="inline-flex">
                  <span>!</span>
                  <span>!</span>
                </span>
              ) : (
                sub
              ),
            )}
          </span>
        );
      }

      // B. Handle !! or ‼ marks (Standalone)
      if (part === "!!" || part === "‼") {
        return (
          <span key={index} className="inline-flex">
            <span>!</span>
            <span>!</span>
          </span>
        );
      }

      // C. Handle the Bold Text (Cost: or Effect：)
      if (
        /[：:]$/.test(part) &&
        !part.startsWith("【") &&
        !part.startsWith("[")
      ) {
        const match = part.match(/^([^()]+)(\([^)]*\))?([:：])$/);
        if (match) {
          const [, mainText, parens, colon] = match;
          return (
            <span key={index}>
              <span className="font-bold text-white">
                {mainText.split(/(‼|!!)/g).map((s, i) =>
                  s === "‼" || s === "!!" ? (
                    <span key={i} className="inline-flex">
                      <span>!</span>
                      <span>!</span>
                    </span>
                  ) : (
                    s
                  ),
                )}
              </span>
              {parens && (
                <span className="font-normal">
                  {parens.split(/(‼|!!)/g).map((s, i) =>
                    s === "‼" || s === "!!" ? (
                      <span key={i} className="inline-flex">
                        <span>!</span>
                        <span>!</span>
                      </span>
                    ) : (
                      s
                    ),
                  )}
                </span>
              )}
              <span className="font-bold text-white">{colon}</span>
            </span>
          );
        }
      }

      // D. Normal text
      return <span key={index}>{part}</span>;
    });
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedCard) return;
      if (e.key === "ArrowLeft") navigateCard(-1);
      if (e.key === "ArrowRight") navigateCard(1);

      // Up/Down: Now both cycle "Forward" to match your single-button UI
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault(); // Prevents the page from scrolling while in the modal
        cycleParallel(1);
      }

      if (e.key === "Escape") setSelectedCard(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCard, navigateCard, cycleParallel]);

  const totalDeckCount = useMemo(
    () => Object.values(deckList).reduce((a, b) => a + b, 0),
    [deckList],
  );

  const orderedDeck = useMemo(() => {
    const entries = Object.entries(deckList)
      .map(([id, count]) => ({
        card: overlaidCards.find((c) => c.id === id),
        count: Number(count),
      }))
      .filter((item) => item.card);

    const leader = entries.find((item) => item.card.category === "Leader");
    const nonLeaders = entries.filter(
      (item) => item.card.category !== "Leader",
    );

    return leader ? [leader, ...nonLeaders] : nonLeaders;
  }, [deckList, overlaidCards]);

  const updatePrice = (id, newPrice) => {
    setMarketData((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        price: newPrice, // Updates the value as you type
      },
    }));
  };

  const toggleMarketType = (id) => {
    setMarketData((prev) => ({
      ...prev,
      [id]: { ...prev[id], type: prev[id]?.type === "BUY" ? "SELL" : "BUY" },
    }));
  };

  const getKeywordStyle = (keyword) => {
    if (!keyword) return "bg-blue-600 text-white px-2 py-1 rounded";

    // 1. Clean the input (e.g., "【登場時】" -> "登場時")
    const cleanK = keyword.replace(/【|】|\[|\]/g, "");

    // 2. Find the internal ID (like 'on_play') from the KEYWORD_MAP
    const keywordId = Object.keys(KEYWORD_MAP || {}).find((id) => {
      const entry = KEYWORD_MAP[id];
      // Clean the map entries too just in case they have brackets
      const cleanZh = entry.zh.replace(/【|】|\[|\]/g, "");
      const cleanEn = entry.en.replace(/【|】|\[|\]/g, "");
      return cleanZh === cleanK || cleanEn === cleanK;
    });

    // 3. Match using ONLY the ID against the rules array
    const match = (rules || []).find((r) => {
      // Your rules use 'ids', not 'keywords'
      return keywordId && r.ids && r.ids.includes(keywordId);
    });

    // 4. Return the specific style or your custom default
    if (match) return match.style;

    // Fallback for "No Effect"
    if (cleanK === "沒有效果" || cleanK === "No Effect")
      return "bg-slate-600 text-white px-2 py-1 rounded";

    // Default Spasta blue
    return "bg-blue-600 text-white px-2 py-1 rounded";
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 px-2 py-4 md:p-8 font-sans flex flex-col">
      <header
        className="
        max-w-7xl mx-auto w-full mb-0 lg:mb-8
        border-b border-slate-800 pb-1 lg:pb-4
      "
      >
        <div
          className="
          flex flex-row flex-nowrap 
          items-center justify-between 
          gap-4 sm:gap-6 md:gap-8
        "
        >
          {/* Left: title */}
          <h1 className="flex-shrink-0">
            <img
              src="/logo512.png"
              alt="齊齊砌"
              className="h-14 lg:h-24 w-auto object-contain"
            />
          </h1>
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 flex-shrink-0 ml-auto">
            {/* 0. Language Switcher Button */}
            <button
              onClick={toggleLanguage}
              className="px-3 py-1 text-xs font-bold border border-white/20 rounded-full hover:bg-white/10 text-white transition-all"
            >
              {i18n.language === "en" ? "中文" : "ENG"}
            </button>

            {/* 1. Import Button */}
            <button
              onClick={() => {
                // 1. Set the mode to IMPORT
                setAppMode("IMPORT");

                // 2. Clean up the old boolean if it's still being used for logic elsewhere
                if (typeof setIsImportingDeck === "function") {
                  setIsImportingDeck(false);
                }
              }}
              className={`
                px-3 py-2 rounded-md transition-all flex items-center justify-center
                ${
                  // FIX: Check for the IMPORT mode string, not the boolean
                  appMode === "IMPORT"
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="導入牌組代碼"
              aria-label="導入牌組代碼"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                // FIX: Icon color now also respects the IMPORT mode
                className={`w-5 h-5 ${appMode === "IMPORT" ? "text-white" : "text-slate-400"}`}
                fill="currentColor"
              >
                <path d="M342.6 73.4C330.1 60.9 309.8 60.9 297.3 73.4L169.3 201.4C156.8 213.9 156.8 234.2 169.3 246.7C181.8 259.2 202.1 259.2 214.6 246.7L288 173.3L288 384C288 401.7 302.3 416 320 416C337.7 416 352 401.7 352 384L352 173.3L425.4 246.7C437.9 259.2 458.2 259.2 470.7 246.7C483.2 234.2 483.2 213.9 470.7 201.4L342.7 73.4zM160 416C160 398.3 145.7 384 128 384C110.3 384 96 398.3 96 416L96 480C96 533 139 576 192 576L448 576C501 576 544 533 544 480L544 416C544 398.3 529.7 384 512 384C494.3 384 480 398.3 480 416L480 480C480 497.7 465.7 512 448 512L192 512C174.3 512 160 497.7 160 480L160 416z" />
              </svg>
            </button>

            {/* 2. Deck Button */}
            <button
              onClick={() => {
                setAppMode("DECK");
                setIsImportingDeck(false); // Force import row to CLOSE
              }}
              className={`
                px-3 py-2 rounded-md transition-all flex items-center justify-center
                ${
                  appMode === "DECK" && !isImportingDeck // Blue only when in Deck mode AND NOT importing
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="製作牌組"
              aria-label="製作牌組"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className={`w-5 h-5 ${appMode === "DECK" ? "text-white" : "text-slate-400"}`}
                fill="currentColor"
              >
                <path d="M246.9 82.3L271 67.8C292.6 54.8 317.3 48 342.5 48C379.3 48 414.7 62.6 440.7 88.7L504.6 152.6C519.6 167.6 528 188 528 209.2L528 240.1L547.7 259.8L547.7 259.8C563.3 244.2 588.6 244.2 604.3 259.8C620 275.4 619.9 300.7 604.3 316.4L540.3 380.4C524.7 396 499.4 396 483.7 380.4C468 364.8 468.1 339.5 483.7 323.8L464 304L433.1 304C411.9 304 391.5 295.6 376.5 280.6L327.4 231.5C312.4 216.5 304 196.1 304 196.1L304 174.9L304 162.2C304 151 298.1 140.5 288.5 134.8L246.9 109.8C236.5 103.6 236.5 88.6 246.9 82.4zM50.7 466.7L272.8 244.6L363.3 335.1L141.2 557.2C116.2 582.2 75.7 582.2 50.7 557.2C25.7 532.2 25.7 491.7 50.7 466.7z" />
              </svg>
            </button>

            {/* 3. Marketplace Button */}
            <button
              onClick={() => {
                setAppMode("MARKETPLACE");
                // ADD THIS LINE TO ALL THREE BUTTONS:
                setIsImportingDeck(false); // Close the import panel and reset color
              }}
              className={`
                px-3 py-2 rounded-md transition-all flex items-center justify-center
                ${
                  appMode === "MARKETPLACE"
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="交易模式 / Marketplace"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className="w-5 h-5"
                fill="currentColor"
              >
                <path d="M0 80C0 53.5 21.5 32 48 32h96c26.5 0 48 21.5 48 48v400c0 26.5-21.5 48-48 48H48c-26.5 0-48-21.5-48-48V80zm224 0c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v400c0 26.5-21.5 48-48 48h-96c-26.5 0-48-21.5-48-48V80zm224 0c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v400c0 26.5-21.5 48-48 48h-96c-26.5 0-48-21.5-48-48V80z" />
              </svg>
            </button>

            {/* 4. Search Button */}
            <button
              onClick={() => {
                setAppMode("SEARCH");
                // ADD THIS LINE TO ALL THREE BUTTONS:
                setIsImportingDeck(false); // Close the import panel and reset color
              }}
              className={`
                px-3 py-2 rounded-md text-sm font-bold transition-all
                flex items-center justify-center
                ${
                  appMode === "SEARCH"
                    ? "bg-blue-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                }
              `}
              title="卡牌搜尋"
              aria-label="卡牌搜尋"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 640 640"
                className={`w-5 h-5 ${appMode === "SEARCH" ? "text-white" : "text-slate-400"}`}
                fill="currentColor"
              >
                <path d="M480 272C480 317.9 465.1 360.3 440 394.7L566.6 521.4C579.1 533.9 579.1 554.2 566.6 566.7C554.1 579.2 533.8 579.2 521.3 566.7L394.7 440C360.3 465.1 317.9 480 272 480C157.1 480 64 386.9 64 272C64 157.1 157.1 64 272 64C386.9 64 480 157.1 480 272zM272 416C351.5 416 416 351.5 416 272C416 192.5 351.5 128 272 128C192.5 128 128 192.5 128 272C128 351.5 192.5 416 272 416z" />
              </svg>
            </button>
          </div>
          {/* Inside your Marketplace Header Div */}
        </div>

        {/* NEW SECOND ROW: Deck vs Market Toggle + Help */}
        <div className="flex items-center justify-end gap-2 mt-1">
          <div className="flex items-center gap-1 p-1 bg-slate-900/80 rounded-xl border border-slate-800 shadow-inner">
            {/* Deck Mode (1+50) - Multiple Cards Icon */}
            <button
              onClick={() => setIsMarketMode(false)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                !isMarketMode
                  ? "bg-indigo-600 text-white shadow-lg"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title="Deck"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="6" width="10" height="14" rx="2" />
                <path d="M6 2h10a2 2 0 0 1 2 2v14" />
                <path d="M10 2h10a2 2 0 0 1 2 2v10" />
              </svg>
              <span className="hidden sm:inline">牌組</span>
            </button>

            {/* Market Mode (Bulk) - Single Card Icon */}
            <button
              onClick={() => setIsMarketMode(true)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                isMarketMode
                  ? "bg-amber-600 text-white shadow-lg"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title="Single"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="6" y="2" width="12" height="20" rx="2" />
                <line x1="10" y1="6" x2="14" y2="6" />
              </svg>
              <span className="hidden sm:inline">單卡</span>
            </button>
          </div>

          {/* Dynamic Help Button */}
          <div className="relative group">
            <button className="p-2 rounded-full bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>

            {/* Tooltip Content using dynamic 'help' variable */}
            <div className="absolute right-0 top-10 w-64 p-4 bg-slate-900 border border-blue-500/50 rounded-xl shadow-2xl invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all z-50">
              <div className="space-y-3">
                {/* <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
                  <span className="text-[10px] font-black text-blue-500 uppercase tracking-tighter">
                    Current Mode: {appMode}
                  </span>
                </div> */}
                <div>
                  <p className="text-indigo-500 text-[10px] font-black uppercase mb-1">
                    牌組模式 (Deck)
                  </p>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {help.deck}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800">
                  <p className="text-amber-500 text-[10px] font-black uppercase mb-1">
                    單卡模式 (Single)
                  </p>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    {help.single}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {isImporting && (
        <div className="max-w-7xl mx-auto w-full mb-8 p-6 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200">
          <h3 className="text-sm font-bold mb-3 text-slate-300">
            導入卡牌 JSON 數據
          </h3>
          <textarea
            className="w-full h-40 bg-slate-900 border border-slate-600 rounded-lg p-3 font-mono text-sm mb-4 focus:border-blue-500 outline-none"
            placeholder="貼上 JSON 數據..."
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
          />
          <button
            onClick={handleImport}
            className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold transition-colors"
          >
            確認匯入
          </button>
        </div>
      )}

      <main className="max-w-7xl mx-auto w-full flex flex-col md:flex-row gap-8 flex-grow">
        {cardsError ? (
          <div className="w-full text-center py-16 text-red-400">
            無法載入卡牌資料：{cardsError}
          </div>
        ) : isCardsLoading ? (
          <div className="w-full text-center py-16 text-slate-400">
            載入卡牌中…
          </div>
        ) : (
          renderContent()
        )}
      </main>

      <footer className="max-w-7xl mx-auto w-full mt-12 py-8 border-t border-slate-800 text-center">
        <p className="text-xs text-slate-500 leading-relaxed">
          All information on this site is copyrighted by ©Eiichiro Oda/Shueisha,
          Toei Animation and Bandai Namco.
        </p>
        <p className="text-[10px] text-slate-600 mt-2 uppercase tracking-widest font-bold">
          齊齊砌
        </p>
      </footer>

      {/* The Back and Next Buttons   */}
      {selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/95 backdrop-blur-md"
          onClick={() => setSelectedCard(null)}
        >
          {/* LEFT NAVIGATION BUTTON - Centered Vertically */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigateCard(-1);
            }}
            className="absolute left-1 md:left-6 top-1/2 -translate-y-1/2 z-[70] w-12 h-24 md:w-16 md:h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-r-xl md:rounded-full transition-all border border-white/10 text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          {/* RIGHT NAVIGATION GROUP - Centered Vertically */}
          <div className="absolute right-1 md:right-6 top-1/2 -translate-y-1/2 z-[70] flex flex-col items-center">
            {/* SINGLE CYCLE BUTTON */}
            {/* Layers/Cycle Icon */}
            {/* SINGLE CYCLE BUTTON */}
            <div className="absolute bottom-full mb-4 flex flex-col items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  cycleParallel(1);
                }}
                className="relative w-12 h-12 md:w-14 md:h-14 flex items-center justify-center bg-amber-500/20 hover:bg-amber-500/40 rounded-full border border-amber-500/40 text-amber-400 transition-all shadow-lg active:scale-95 group"
                title="Cycle Parallel Version"
              >
                {/* The Chinese Character "異" */}
                <span className="text-xl md:text-2xl font-black mb-0.5 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)] group-hover:scale-110 transition-transform">
                  異
                </span>
              </button>
            </div>

            {/* RIGHT NAVIGATION (NEXT) BUTTON */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateCard(1);
              }}
              className="w-12 h-24 md:w-16 md:h-16 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-l-xl md:rounded-full transition-all border border-white/10 text-white shadow-xl"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          {/* MAIN MODAL CONTENT */}
          <div
            className="bg-slate-800 w-full md:max-w-5xl h-full md:h-auto md:max-h-[90vh] overflow-y-auto rounded-none md:rounded-2xl p-6 md:p-10 flex flex-col md:flex-row gap-8 relative border border-slate-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Language Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleLanguage();
              }}
              className="absolute top-4 left-4 z-[80] px-2.5 py-1 rounded-lg text-xs font-bold border transition-all"
              style={
                langCode === "en"
                  ? {
                      background: "rgba(99,102,241,0.15)",
                      color: "#a5b4fc",
                      borderColor: "rgba(99,102,241,0.3)",
                    }
                  : {
                      background: "rgba(100,116,139,0.15)",
                      color: "#94a3b8",
                      borderColor: "rgba(100,116,139,0.3)",
                    }
              }
            >
              {langCode === "en" ? "中" : "EN"}
            </button>

            {/* Close Button */}
            <button
              onClick={() => setSelectedCard(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-transform hover:scale-110 z-[80]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* LEFT SIDE: Image */}
            <div className="w-full md:w-5/12 flex justify-center items-start">
              <img
                key={selectedCard.id}
                src={getSafeImageUrl(selectedCard)}
                referrerPolicy="no-referrer"
                className="rounded-xl shadow-2xl w-full max-w-[320px] md:max-w-none border border-slate-700 object-contain h-auto"
                alt={displayCard.name}
              />
            </div>

            {/* RIGHT SIDE: Details */}
            <div className="w-full md:w-7/12 space-y-4 text-left">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-blue-500 font-mono font-bold tracking-widest text-xs">
                      {selectedCard.id}
                    </span>
                    <div className="flex gap-1.5">
                      {selectedCard.colors?.map((c) => (
                        <span
                          key={c}
                          className="w-2.5 h-2.5 rounded-full border border-white/20"
                          style={{ backgroundColor: c.toLowerCase() }}
                        ></span>
                      ))}
                    </div>
                  </div>
                  <h2 className="text-2xl md:text-4xl font-black text-white">
                    {displayCard.name}
                  </h2>
                </div>

                <div className="flex flex-col items-end flex-shrink-0">
                  <div className="flex gap-1.5 md:gap-2">
                    {/* 1. MINUS BUTTON */}
                    <button
                      onClick={() => updateDeckCount(selectedCard, -1)}
                      className="w-9 h-9 md:w-10 md:h-10 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center justify-center font-bold text-xl text-white active:scale-90 transition-transform"
                    >
                      -
                    </button>

                    {/* 2. DYNAMIC COUNTER DISPLAY */}
                    <div
                      className={`w-9 h-9 md:w-10 md:h-10 rounded-lg flex items-center justify-center font-black text-sm md:text-base shadow-inner ${
                        isMarketMode
                          ? "bg-white text-black"
                          : "bg-white text-black"
                      }`}
                    >
                      {/* Logic: Show marketList count if in Single mode, otherwise deckList */}
                      {(isMarketMode
                        ? marketList[selectedCard.id]
                        : deckList[selectedCard.id]) || 0}
                    </div>

                    {/* 3. PLUS BUTTON (With Mode-Based Disabling) */}
                    <button
                      onClick={() => updateDeckCount(selectedCard, 1)}
                      disabled={
                        !isMarketMode &&
                        ((selectedCard.category === "Leader" &&
                          deckList[selectedCard.id] === 1) ||
                          (selectedCard.category !== "Leader" &&
                            !UNLIMITED_COPIES.includes(
                              getBaseId(selectedCard.id),
                            ) &&
                            getBaseIdCount(selectedCard.id) >= 4))
                      }
                      className={`w-9 h-9 md:w-10 md:h-10 rounded-lg flex items-center justify-center font-bold text-xl text-white transition-all active:scale-90 ${
                        isMarketMode
                          ? "bg-amber-600 hover:bg-amber-500 disabled:opacity-30"
                          : "bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30"
                      }`}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* --- NEW PRICE SECTION --- */}
              {(() => {
                const priceInfo = cardPrices.prices?.find(
                  (p) => p.id === selectedCard.id,
                );
                const lastUpdate = cardPrices.metadata?.lastUpdated;

                if (priceInfo) {
                  return (
                    <div className="mt-2 flex items-baseline gap-2">
                      <p className="text-sm text-white-800 opacity-90">
                        {langCode === "en"
                          ? "Reference Price (Yuyu-tei):"
                          : "參考價 (遊々亭)："}{" "}
                        ¥{priceInfo.jpy.toLocaleString()} / HK$
                        {Number(priceInfo.hkd).toLocaleString()}
                      </p>
                      {lastUpdate && (
                        <p className="text-[9px] text-slate-400 italic">
                          ({lastUpdate})
                        </p>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              {/* Card Effect and Trigger */}
              <div className="bg-slate-700/50 p-2 rounded-xl border-l-4 border-blue-500">
                {/* <p className="text-[10px] text-slate-400 uppercase font-bold mb-2 tracking-widest">效果說明 / Effect</p> */}
                <div className="text-sm leading-relaxed text-slate-100 whitespace-pre-wrap font-medium">
                  {renderFormattedEffect(displayCard.effect) || "無效果內容"}
                </div>
              </div>
              {displayCard.trigger && (
                <div className="bg-yellow-900/20 p-2 mt-0.5 rounded-xl border-l-4 border-yellow-500">
                  {/* <p className="text-[10px] text-yellow-500 uppercase font-bold mb-2 tracking-widest">觸發效果 / Trigger</p> */}
                  <div className="text-sm leading-relaxed text-yellow-100 font-medium whitespace-pre-wrap">
                    {renderFormattedEffect(displayCard.trigger)}
                  </div>
                </div>
              )}

              <div>
                <div className="flex flex-wrap gap-2">
                  {displayCard.types?.map((t) => (
                    <span
                      key={t}
                      className="px-3 py-1 bg-blue-900/30 text-blue-300 border border-blue-500/30 rounded-md text-sm font-bold"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Inside your card detail modal or sidebar */}
              <div className="card-info">
                <CardQA currentCardId={selectedCard.id} />
              </div>

              {selectedCard.pack_id &&
                packByNumericId[String(selectedCard.pack_id)] && (
                  <p className="text-xs text-slate-400 mt-2">
                    {langCode === "en" ? "Card Set: " : "收錄於："}
                    {packByNumericId[String(selectedCard.pack_id)]}
                  </p>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
