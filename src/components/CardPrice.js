import React, { useState, useEffect } from "react"; // 必須加入這行
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig"; // 注意路徑可能需要改為 ../firebaseConfig

const CardPrice = ({ cardId }) => {
  const [priceData, setPriceData] = useState(null);

  useEffect(() => {
    const fetchPrice = async () => {
      if (!cardId) return;
      const docRef = doc(db, "card_prices", cardId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setPriceData(docSnap.data());
      }
    };
    fetchPrice();
  }, [cardId]);

  if (!priceData) return <span>Loading price...</span>;

  return (
    <div className="price-tag" style={{ fontSize: "0.8rem", color: "#666" }}>
      <div>JP: ¥{priceData.jpy}</div>
      <div>HK: ${priceData.hkd}</div>
    </div>
  );
};

export default CardPrice; // 導出組件
