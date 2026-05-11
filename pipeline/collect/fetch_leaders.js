// Run once: node pipeline/collect/fetch_leaders.js
// Prints all leader card IDs with block_number 2–5 from Firestore.
require("dotenv").config();
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const col = collection(
    db,
    "artifacts",
    "one-piece-card-db",
    "public",
    "data",
    "cards",
  );
  const snap = await getDocs(col);
  const leaders = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const cat = d.category || "";
    const block = d.block_number;
    const id = d.id || doc.id;
    if (id.includes("_")) return; // skip parallel/reprint suffixes
    if ((cat === "Leader" || cat === "領航") && block >= 2 && block <= 5) {
      leaders.push(id);
    }
  });
  leaders.sort();
  console.log(JSON.stringify(leaders, null, 2));
  console.log(`\nTotal: ${leaders.length}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
