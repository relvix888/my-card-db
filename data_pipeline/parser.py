import instructor
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import Optional, List
import json

# 1. 定義 Pydantic 模型
class CardEffectLogic(BaseModel):
    """用於解析航海王卡牌效果邏輯的模型"""
    has_action_cost: bool = Field(description="效果是否包含冒號(:)之前的啟動代價")
    action_cost_text: Optional[str] = Field(None, description="冒號(:)之前的文字，例如：【KO時】可以廢棄1張自己的手牌")
    ability_text: str = Field(description="冒號(:)之後的實際效果文字")
    
    # 數值化評分（這部分由 AI 根據效果強度判斷）
    impact_score: float = Field(description="該效果的理論強度評分 (0.0 到 1.0)")
    is_resource_neutral: bool = Field(description="是否為資源交換（如：抽1捨1）")

class OPCGCard(BaseModel):
    id: str
    name: str
    cost: int
    effect_logic: CardEffectLogic = Field(description="將原始 effect 欄位解析為邏輯結構")

# 2. 初始化 Instructor (使用 DeepSeek API)
# 注意：如果你使用本地 Ollama，base_url 請換成 http://localhost:11434/v1
client = instructor.from_openai(
    OpenAI(
        base_url="https://api.deepseek.com", 
        api_key="你的_DEEPSEEK_API_KEY"
    ),
    mode=instructor.Mode.JSON,
)

def parse_card_data(raw_card):
    """調用 DeepSeek 進行結構化提取"""
    # 處理 HTML 標籤（如 <br>）
    clean_effect = raw_card['effect'].replace("<br>", " ")
    
    return client.chat.completions.create(
        model="deepseek-chat",
        response_model=OPCGCard,
        messages=[
            {"role": "system", "content": "你是一個專業的航海王卡牌遊戲數值分析師。請將卡牌效果拆解為邏輯代價與能力。"},
            {"role": "user", "content": f"解析以下卡牌數據：{json.dumps(raw_card, ensure_ascii=False)}"}
        ],
    )

# 3. 執行範例
example_data = {
    "id": "OP13-104",
    "name": "光月日和",
    "cost": 4,
    "effect": "【防禦】<br>【KO時】可以廢棄1張自己的手牌：若自己的領航卡有多種顏色時，將最多1張自己卡組上面的卡片加入生命值區上面。"
}

try:
    parsed_card = parse_card_data(example_data)
    
    print(f"卡牌名稱: {parsed_card.name}")
    print(f"效果代價: {parsed_card.effect_logic.action_cost_text}")
    print(f"具體能力: {parsed_card.effect_logic.ability_text}")
    print(f"強度評分: {parsed_card.effect_logic.impact_score}")
    
except Exception as e:
    print(f"解析出錯: {e}")