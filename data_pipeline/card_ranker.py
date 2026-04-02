import re

# weighting_config.py
WEIGHTS = {
    "power_per_cost": 500,
    "draw_per_card": 1200,
    "play_char_base": 1500,
    "play_char_cost_mult": 300,
    "opp_pwr_per_1k": 400,
    "ko_effect": 2000,
    "don_attach_per_card": 400,
    "antiremoval_base": 800,
    "protection_threshold_mult": 0.1,
    "self_buff_permanent_next": 1000, 
    "self_buff_burst": 600,          
    "freeze_per_card": 1500,         
    "rest_per_card": 800,            
    "anti_rest_per_card": 700,       
    "restand_base": 1800,            
    "restand_cost_mult": 200         
}

class CardRanker:
    def __init__(self):
        self.patterns = {
            "draw": r"最多(\d+)張.*加入手牌",
            "opp_pwr": r"對手.*力量值-(\d+)",
            "ko": r"KO.*角色卡",
            "play_char": r"使最多(\d+)張.*費用(\d+)以下的角色卡.*登場",
            "don_attach": r"附加最多(\d+)張.*的咚!!卡",
            "antiremoval": r"原本力量值(\d+)以下的角色卡.*即將離開場上",
            "self_buff_next_turn": r"自己的領航卡，在下一個對手結束階段結束前，力量值\+(\d+)",
            "self_buff_this_turn": r"自己的領航卡，在這個回合，力量值\+(\d+)",
            "opp_debuff_next_turn": r"最多(\d+)張對手的角色卡，在下一個對手結束階段結束前，力量值-(\d+)",
            "opp_not_activate": r"最多(\d+)張對手.*卡片，在下一個對手的重整階段無法為活動狀態",
            "opp_rest": r"將最多(\d+)張對手的角色卡置為休息狀態",
            "opp_not_rest": r"最多(\d+)張對手費用(\d+)以下的角色卡，在下一個對手結束階段結束前，無法置為休息狀態",
            "self_set_active": r"將最多(\d+)張自己原本費用(\d+)以下的角色卡置為活動狀態"
        }

    def parse_all_effects(self, text):
        results = {"draw": 0, "opp_pwr": 0, "has_ko": 0}
        if text is None or not isinstance(text, str) or text == "-":
            return results

        effect_part = text.split("：", 1)[1] if "：" in text else text

        # Use search and store in results safely
        draw_match = re.search(self.patterns["draw"], effect_part)
        if draw_match: results["draw"] = int(draw_match.group(1))

        pwr_match = re.search(self.patterns["opp_pwr"], effect_part)
        if pwr_match: results["opp_pwr"] = int(pwr_match.group(1))

        if re.search(self.patterns["ko"], effect_part): results["has_ko"] = 1
        
        # Add logic for Rest effects (New)
        rest_match = re.search(self.patterns["opp_rest"], effect_part)
        if rest_match: results["rest_count"] = int(rest_match.group(1))

        return results

    def calculate_rank(self, card_data):
        category = card_data.get("category", "Character")
        cost = card_data.get("cost")
        power = card_data.get("power")
        effect_text = card_data.get("effect")

        safe_cost = int(cost) if cost is not None else 0
        safe_power = int(power) if power is not None else 0

        effects = self.parse_all_effects(effect_text)
        
        # 1. Base Stat Score
        if category == "Leader":
            # Higher Life (Cost) is better for Leaders
            stat_score = (safe_power + (safe_cost * 1000)) 
        else:
            stat_score = (safe_power / (safe_cost if safe_cost > 0 else 1)) * WEIGHTS["power_per_cost"]

        score = stat_score
        
        # 2. Add Weighted Effects (Use .get() to avoid KeyErrors)
        if effects.get("draw", 0) > 0:
            score += effects["draw"] * WEIGHTS["draw_per_card"]
            
        if "play_count" in effects:
            score += WEIGHTS["play_char_base"] + (effects["play_cost_limit"] * WEIGHTS["play_char_cost_mult"])
            
        if effects.get("opp_pwr", 0) > 0:
            score += (effects["opp_pwr"] / 1000) * WEIGHTS["opp_pwr_per_1k"]
            
        if effects.get("has_ko"):
            score += WEIGHTS["ko_effect"]

        if "rest_count" in effects:
            score += effects["rest_count"] * WEIGHTS["rest_per_card"]

        return round(score, 0)

# --- Test Case (None replaced with None) ---
ranker = CardRanker()
cards = [
  {
    "id": "ST29-001",
    "pack_id": "554029",
    "name": "蒙其・D・魯夫",
    "rarity": "Leader",
    "category": "Leader",
    "img_url": "../images/cardlist/card/ST29-001.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-001.png?251121",
    "cost": 6,
    "attributes": ["Strike"],
    "power": 5000,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "四皇", "草帽一行人"],
    "effect": "【攻擊時】若自己的生命值卡在2張以下時，抽1張卡片，並廢棄1張自己的手牌。",
    "trigger": None
  },
  {
    "id": "ST29-001_p1",
    "pack_id": "554029",
    "name": "蒙其・D・魯夫",
    "rarity": "Leader",
    "category": "Leader",
    "img_url": "../images/cardlist/card/ST29-001_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-001_p1.png?251121",
    "cost": 6,
    "attributes": ["Strike"],
    "power": 5000,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "四皇", "草帽一行人"],
    "effect": "【攻擊時】若自己的生命值卡在2張以下時，抽1張卡片，並廢棄1張自己的手牌。",
    "trigger": None
  },
  {
    "id": "ST29-002",
    "pack_id": "554029",
    "name": "騙人布",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-002.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-002.png?251121",
    "cost": 3,
    "attributes": ["Ranged"],
    "power": 4000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【登場時】/【攻擊時】將最多1張對手費用數值在對手的生命值卡張數以下的角色卡置為休息狀態。",
    "trigger": None
  },
  {
    "id": "ST29-002_p1",
    "pack_id": "554029",
    "name": "騙人布",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-002_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-002_p1.png?251121",
    "cost": 3,
    "attributes": ["Ranged"],
    "power": 4000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【登場時】/【攻擊時】將最多1張對手費用數值在對手的生命值卡張數以下的角色卡置為休息狀態。",
    "trigger": None
  },
  {
    "id": "ST29-003",
    "pack_id": "554029",
    "name": "卡古",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-003.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-003.png?251121",
    "cost": 4,
    "attributes": ["Slash"],
    "power": 5000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "CP0"],
    "effect": "若自己的生命值卡張數少於等於對手的生命值卡張數時，這張角色卡的力量值+1000。",
    "trigger": "【觸發器】KO最多1張對手費用3以下的角色卡。"
  },
  {
    "id": "ST29-003_p1",
    "pack_id": "554029",
    "name": "卡古",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-003_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-003_p1.png?251121",
    "cost": 4,
    "attributes": ["Slash"],
    "power": 5000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "CP0"],
    "effect": "若自己的生命值卡張數少於等於對手的生命值卡張數時，這張角色卡的力量值+1000。",
    "trigger": "【觸發器】KO最多1張對手費用3以下的角色卡。"
  },
  {
    "id": "ST29-004",
    "pack_id": "554029",
    "name": "香吉士",
    "rarity": "SuperRare",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-004.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-004.png?251121",
    "cost": 4,
    "attributes": ["Strike"],
    "power": 5000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【登場時】從自己的卡組上面查看4張卡片，公開最多1張擁有《草帽一行人》特徵的卡片，並加入手牌。之後，將其餘卡片依任意順序放到卡組下面。",
    "trigger": "【觸發器】可以廢棄1張自己的手牌：使這張卡片登場。"
  },
  {
    "id": "ST29-004_p1",
    "pack_id": "554029",
    "name": "香吉士",
    "rarity": "SuperRare",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-004_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-004_p1.png?251121",
    "cost": 4,
    "attributes": ["Strike"],
    "power": 5000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【登場時】從自己的卡組上面查看4張卡片，公開最多1張擁有《草帽一行人》特徵的卡片，並加入手牌。之後，將其餘卡片依任意順序放到卡組下面。",
    "trigger": "【觸發器】可以廢棄1張自己的手牌：使這張卡片登場。"
  },
  {
    "id": "ST29-005",
    "pack_id": "554029",
    "name": "吉貝爾",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-005.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-005.png?251121",
    "cost": 6,
    "attributes": ["Strike"],
    "power": 5000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["魚人族", "蛋頭", "草帽一行人"],
    "effect": "-",
    "trigger": "【觸發器】若自己的領航卡是「蒙其・D・魯夫」時，使這張卡片登場。"
  },
  {
    "id": "ST29-005_p1",
    "pack_id": "554029",
    "name": "吉貝爾",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-005_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-005_p1.png?251121",
    "cost": 6,
    "attributes": ["Strike"],
    "power": 5000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["魚人族", "蛋頭", "草帽一行人"],
    "effect": "-",
    "trigger": "【觸發器】若自己的領航卡是「蒙其・D・魯夫」時，使這張卡片登場。"
  },
  {
    "id": "ST29-006",
    "pack_id": "554029",
    "name": "絲媞希",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-006.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-006.png?251121",
    "cost": 6,
    "attributes": ["Special"],
    "power": 7000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭"],
    "effect": "-",
    "trigger": None
  },
  {
    "id": "ST29-006_p1",
    "pack_id": "554029",
    "name": "絲媞希",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-006_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-006_p1.png?251121",
    "cost": 6,
    "attributes": ["Special"],
    "power": 7000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭"],
    "effect": "-",
    "trigger": None
  },
  {
    "id": "ST29-007",
    "pack_id": "554029",
    "name": "多尼多尼・喬巴",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-007.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-007.png?251121",
    "cost": 4,
    "attributes": ["Wisdom"],
    "power": 5000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["動物", "蛋頭", "草帽一行人"],
    "effect": "【KO時】可將1張自己生命值區上面或下面的卡片加入手牌：將最多1張自己的手牌加入生命值區上面。",
    "trigger": "【觸發器】最多1張自己的「蒙其・D・魯夫」，在這個回合，力量值+2000。"
  },
  {
    "id": "ST29-007_p1",
    "pack_id": "554029",
    "name": "多尼多尼・喬巴",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-007_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-007_p1.png?251121",
    "cost": 4,
    "attributes": ["Wisdom"],
    "power": 5000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["動物", "蛋頭", "草帽一行人"],
    "effect": "【KO時】可將1張自己生命值區上面或下面的卡片加入手牌：將最多1張自己的手牌加入生命值區上面。",
    "trigger": "【觸發器】最多1張自己的「蒙其・D・魯夫」，在這個回合，力量值+2000。"
  },
  {
    "id": "ST29-008",
    "pack_id": "554029",
    "name": "娜美",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-008.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-008.png?251121",
    "cost": 3,
    "attributes": ["Special"],
    "power": 1000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "若自己擁有《蛋頭》特徵的角色卡因對手的效果即將遭到KO時，可以替換成將1張自己生命值區上面的卡片翻成正面朝上。",
    "trigger": "【觸發器】若自己的領航卡是「蒙其・D・魯夫」時，使這張卡片登場。"
  },
  {
    "id": "ST29-008_p1",
    "pack_id": "554029",
    "name": "娜美",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-008_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-008_p1.png?251121",
    "cost": 3,
    "attributes": ["Special"],
    "power": 1000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "若自己擁有《蛋頭》特徵的角色卡因對手的效果即將遭到KO時，可以替換成將1張自己生命值區上面的卡片翻成正面朝上。",
    "trigger": "【觸發器】若自己的領航卡是「蒙其・D・魯夫」時，使這張卡片登場。"
  },
  {
    "id": "ST29-009",
    "pack_id": "554029",
    "name": "妮可・羅賓",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-009.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-009.png?251121",
    "cost": 4,
    "attributes": ["Strike"],
    "power": 2000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【防禦】(對手攻擊後，將這張卡片置為休息狀態即可使攻擊的對象換成這張卡片)",
    "trigger": "【觸發器】若自己的領航卡是「蒙其・D・魯夫」時，使這張卡片登場。"
  },
  {
    "id": "ST29-009_p1",
    "pack_id": "554029",
    "name": "妮可・羅賓",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-009_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-009_p1.png?251121",
    "cost": 4,
    "attributes": ["Strike"],
    "power": 2000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【防禦】(對手攻擊後，將這張卡片置為休息狀態即可使攻擊的對象換成這張卡片)",
    "trigger": "【觸發器】若自己的領航卡是「蒙其・D・魯夫」時，使這張卡片登場。"
  },
  {
    "id": "ST29-010",
    "pack_id": "554029",
    "name": "佛朗基",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-010.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-010.png?251121",
    "cost": 5,
    "attributes": ["Ranged"],
    "power": 6000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "-",
    "trigger": None
  },
  {
    "id": "ST29-010_p1",
    "pack_id": "554029",
    "name": "佛朗基",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-010_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-010_p1.png?251121",
    "cost": 5,
    "attributes": ["Ranged"],
    "power": 6000,
    "counter": 2000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "-",
    "trigger": None
  },
  {
    "id": "ST29-011",
    "pack_id": "554029",
    "name": "布魯克",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-011.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-011.png?251121",
    "cost": 2,
    "attributes": ["Slash"],
    "power": 2000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【防禦】(對手攻擊後，將這張卡片置為休息狀態即可使攻擊的對象換成這張卡片)",
    "trigger": None
  },
  {
    "id": "ST29-011_p1",
    "pack_id": "554029",
    "name": "布魯克",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-011_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-011_p1.png?251121",
    "cost": 2,
    "attributes": ["Slash"],
    "power": 2000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【防禦】(對手攻擊後，將這張卡片置為休息狀態即可使攻擊的對象換成這張卡片)",
    "trigger": None
  },
  {
    "id": "ST29-012",
    "pack_id": "554029",
    "name": "蒙其・D・魯夫",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-012.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-012.png?251121",
    "cost": 1,
    "attributes": ["Strike"],
    "power": None,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "四皇", "草帽一行人"],
    "effect": "【啟動主要】【每回合1次】附加最多1張休息狀態的咚‼卡在1張自己的「蒙其・D・魯夫」。",
    "trigger": "【觸發器】使這張卡片登場。"
  },
  {
    "id": "ST29-012_p1",
    "pack_id": "554029",
    "name": "蒙其・D・魯夫",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-012_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-012_p1.png?251121",
    "cost": 1,
    "attributes": ["Strike"],
    "power": None,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "四皇", "草帽一行人"],
    "effect": "【啟動主要】【每回合1次】附加最多1張休息狀態的咚‼卡在1張自己的「蒙其・D・魯夫」。",
    "trigger": "【觸發器】使這張卡片登場。"
  },
  {
    "id": "ST29-013",
    "pack_id": "554029",
    "name": "羅布・路基",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-013.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-013.png?251121",
    "cost": 5,
    "attributes": ["Strike"],
    "power": 6000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "CP0"],
    "effect": "-",
    "trigger": "【觸發器】KO最多1張對手費用數值在雙方生命值卡合計張數以下的角色卡。"
  },
  {
    "id": "ST29-013_p1",
    "pack_id": "554029",
    "name": "羅布・路基",
    "rarity": "Common",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-013_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-013_p1.png?251121",
    "cost": 5,
    "attributes": ["Strike"],
    "power": 6000,
    "counter": 1000,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "CP0"],
    "effect": "-",
    "trigger": "【觸發器】KO最多1張對手費用數值在雙方生命值卡合計張數以下的角色卡。"
  },
  {
    "id": "ST29-014",
    "pack_id": "554029",
    "name": "羅羅亞・索隆",
    "rarity": "SuperRare",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-014.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-014.png?251121",
    "cost": 6,
    "attributes": ["Slash"],
    "power": 8000,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【速攻：角色】(這張卡片在登場的回合即可攻擊角色卡)<br>【啟動主要】【每回合1次】可以廢棄1張自己手牌中持有【觸發器】的卡片：抽1張卡片，附加最多1張休息狀態的咚‼卡在1張自己的領航卡或角色卡。",
    "trigger": None
  },
  {
    "id": "ST29-014_p1",
    "pack_id": "554029",
    "name": "羅羅亞・索隆",
    "rarity": "SuperRare",
    "category": "Character",
    "img_url": "../images/cardlist/card/ST29-014_p1.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-014_p1.png?251121",
    "cost": 6,
    "attributes": ["Slash"],
    "power": 8000,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【速攻：角色】(這張卡片在登場的回合即可攻擊角色卡)<br>【啟動主要】【每回合1次】可以廢棄1張自己手牌中持有【觸發器】的卡片：抽1張卡片，附加最多1張休息狀態的咚‼卡在1張自己的領航卡或角色卡。",
    "trigger": None
  },
  {
    "id": "ST29-015",
    "pack_id": "554029",
    "name": "溫度一分熟STRIKE",
    "rarity": "Common",
    "category": "Event",
    "img_url": "../images/cardlist/card/ST29-015.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-015.png?251121",
    "cost": 1,
    "attributes": [],
    "power": None,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【反擊】最多1張自己的領航卡或角色卡，在這場對戰中，力量值+2000。之後，若自己的生命值卡在1張以下時，最多1張對手的領航卡或角色卡，在這個回合，力量值-2000。",
    "trigger": "【觸發器】抽1張卡片。"
  },
  {
    "id": "ST29-016",
    "pack_id": "554029",
    "name": "黄猿‼我們比2年前強了100倍喔",
    "rarity": "Common",
    "category": "Event",
    "img_url": "../images/cardlist/card/ST29-016.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-016.png?251121",
    "cost": 1,
    "attributes": [],
    "power": None,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "四皇", "草帽一行人"],
    "effect": "【主要】自己的領航卡「蒙其・D・魯夫」，在這個回合，獲得【防禦不可】。<br>(這張卡片不會遭到防禦)<br>【反擊】自己的領航卡，在這場對戰中，力量值+3000。",
    "trigger": None
  },
  {
    "id": "ST29-017",
    "pack_id": "554029",
    "name": "死・獅子歌歌",
    "rarity": "Common",
    "category": "Event",
    "img_url": "../images/cardlist/card/ST29-017.png?251121",
    "img_full_url": "https://asia-hk.onepiece-cardgame.com/images/cardlist/card/ST29-017.png?251121",
    "cost": 2,
    "attributes": [],
    "power": None,
    "counter": None,
    "colors": ["Yellow"],
    "block_number": 4,
    "types": ["蛋頭", "草帽一行人"],
    "effect": "【反擊】最多1張自己的領航卡或角色卡，在這場對戰中，力量值+4000。之後，若自己的生命值卡在2張以下時，KO最多1張對手費用3以下的角色卡。",
    "trigger": "【觸發器】抽2張卡片，並廢棄1張自己的手牌。"
  }
]


for c in cards:
    score = ranker.calculate_rank(c)
    print(f"Card: {c['name']} | Rank Score: {score}")