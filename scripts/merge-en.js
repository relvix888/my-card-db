const fs = require("fs");
const path = require("path");

const enDir = path.resolve(__dirname, "../../opc-uploader/data/EN");
const files = fs.readdirSync(enDir).filter(f => f.endsWith(".json"));

const enCards = {};
const typesSet = new Set();

for (const f of files) {
  const cards = JSON.parse(fs.readFileSync(path.join(enDir, f)));
  for (const c of cards) {
    enCards[c.id] = {
      name: c.name,
      effect: c.effect,
      types: c.types ?? [],
      trigger: c.trigger ?? null,
      pack_id: c.pack_id,
    };
    (c.types ?? []).forEach(t => typesSet.add(t));
  }
}

fs.writeFileSync(
  path.resolve(__dirname, "../src/data/en_cards.json"),
  JSON.stringify(enCards, null, 2)
);
fs.writeFileSync(
  path.resolve(__dirname, "../src/data/sorted_types_en.json"),
  JSON.stringify([...typesSet].sort(), null, 2)
);

console.log(`Wrote ${Object.keys(enCards).length} cards, ${typesSet.size} EN types`);
