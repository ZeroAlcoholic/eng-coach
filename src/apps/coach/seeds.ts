// One-tap「換個新劇情」: ready-made briefs the scenario / arc generator can turn
// into a fresh scenario without the learner typing anything. Each seed is a
// complete brief in the shape ai/scenario.ts and ai/arc.ts extract best from
// (a concrete place, named people, a reason to talk, a twist) — the twist is
// what gives the coach beats to drive, so the learner is never asked for a
// topic. English = the 2026 workplace; Japanese = travel. Picking excludes
// seeds already turned into a scenario on this device (Scenario.source keeps
// the brief verbatim), so「隨機」does not hand back the same story twice until
// every seed has been used.

import type { TargetLanguage } from "../../kernel/types";

export const SEED_BRIEFS: Record<TargetLanguage, readonly string[]> = {
  en: [
    "新加坡總部的 Priya 要你在 15 分鐘的電話裡說明，為什麼你們部門這一季的理賠處理時間變長了 20%。她手上有數字，會直接追問原因與改善時程；你知道真正原因是新系統上線後人員還不熟。",
    "你和美國供應商的客戶經理 Daniel 開會，對方想把明年的授權費調漲 18%。你要爭取降到 8% 以下，籌碼是你們願意多簽一年並當他們的參考客戶；Daniel 會先說「總部不會同意」。",
    "公司要在下週決定是否把客服聊天機器人換成另一家的生成式 AI 方案。你負責向區域主管 Elena 做 10 分鐘口頭簡報，說明兩個方案的差異、成本與風險，Elena 最在意個資外流與誤答客戶。",
    "一位剛從倫敦調來的新同事 Oliver 第一天報到，你負責帶他認識環境。你要介紹團隊、說明每週例會怎麼開、告訴他哪些事情要先問誰，並回答他關於台北生活的問題。",
    "你負責的專案延遲了三週，今天要在跨國週會上向專案贊助人 Mark 說明。你要說清楚延遲原因（供應商 API 改版）、已經做的補救、新的時程，並在他問「還會再延嗎」時給出誠實的答案。",
    "你在一場保險科技研討會的茶敘時間遇到一位來自澳洲的講者 Hannah，她剛講完「AI 在核保的應用」。你想和她交換名片、聊聊她提到的案例，並探詢她是否願意來你們公司分享。",
    "法遵部門的 Sophie 收到一封客訴，說你們的 AI 客服把一位客戶的保單條款解釋錯了。她要你在會議中重演事情經過、說明怎麼發現、怎麼補救，並提出避免再發生的做法。",
    "你的團隊要招一位資料分析師，今天你用英文面試一位來自菲律賓的候選人 Carlo。你要介紹職位、問他過去的專案、問他怎麼處理與主管意見不合的情況，並回答他關於薪資與遠端工作的問題。",
    "總部宣布明年起所有內部報告都要用英文寫，你的台灣同事很焦慮。今天你和總部的人資夥伴 Jessica 開會，要替團隊爭取過渡期、培訓資源，並說明你們實際的英文程度與困難。",
    "你出差到東京參加區域會議，晚上和日本與韓國的同事吃飯閒聊。你要聊各自公司最近的變化、台灣的生活與美食、週末的計畫，並在對方問「你覺得 AI 會取代我們的工作嗎」時說出自己的看法。",
    "供應商的系統昨晚當機兩小時，影響了你們的線上投保。今天供應商的技術主管 Ravi 來說明，你要問清楚原因、問他們怎麼確保不再發生、要求書面的事故報告，並討論合約裡的賠償條款。",
    "你被指派主持下季的跨部門 AI 工作坊，今天和外部講師 Megan 討論課程設計。你要說明學員的背景與程度、希望涵蓋的主題、時間與預算限制，並對她提出的「全英文授課」表達保留。",
    "你的主管 Karen 臨時請你代替她參加和英國再保公司的視訊會議。對方的 James 想了解你們去年颱風理賠的經驗，你要用自己知道的部分回答、不確定的地方坦白說會再確認，並約好後續。",
    "你想向區域總部申請預算，試行一個用 AI 自動整理會議紀錄的工具。財務夥伴 Lucas 要你在電話裡說明：要花多少、省多少時間、風險是什麼、為什麼不用免費工具，他會一直問數字。",
  ],
  ja: [
    "大阪的居酒屋，你和同行的朋友想點三道菜和飲料，但菜單沒有圖片。店員山田很熱情，會推薦當日特餐；你要問清楚哪道不辣、有沒有生食，最後想分開結帳。",
    "你在京都車站的觀光服務處，想去嵐山但不確定搭巴士還是電車比較快。櫃台的佐藤小姐會問你幾點要到、要不要買一日券；你要問怎麼走、多久、多少錢。",
    "你在東京的旅館櫃台辦理退房，發現帳單多了一筆迷你吧的費用，但你沒有用。你要說明情況請對方確認，並順便請他們幫你保管行李到下午四點。",
    "你在北海道的滑雪場租裝備。店員會問你的身高、鞋子尺寸和程度；你是初學者，想問有沒有中文教練、課程幾點開始、摔倒受傷怎麼辦。",
    "你搭的新幹線因為大雪延誤，你要趕今晚的飛機。你到車站的綠色窗口向站務員說明狀況，問有沒有其他路線、能不能改票或退票。",
    "你在藥妝店想買暈車藥和胃藥，但看不懂包裝。你向店員說明症狀（搭船會暈、吃太飽胃痛），問一天吃幾次、能不能和感冒藥一起吃，並問免稅怎麼辦。",
    "你在福岡的拉麵店排隊三十分鐘終於進店，店員問你麵的硬度、湯的濃度和要不要加蛋。你要照自己的喜好回答，並在吃完後問能不能加麵、怎麼結帳。",
    "你在沖繩租車，還車時店員說車身有一道小刮痕。你確定不是你弄的，要說明你取車時就有、問保險能不能處理，並想請對方幫你叫計程車去機場。",
    "你在金澤的和菓子老店想買伴手禮送同事，有五個人、預算五千日圓。店員會介紹幾種、問你要常溫還是冷藏、能放幾天；你要請對方分開包裝並問能不能刷卡。",
    "你在東京地鐵把雨傘和一個紙袋忘在車上。你到站務室向站務員說明是哪一條線、幾點的車、坐在哪節車廂，描述東西的樣子，並留下聯絡方式。",
    "你在溫泉旅館的晚餐時間，服務人員山本小姐一道一道上菜。你想問每道菜是什麼、哪些可以不吃（你不吃生魚），並聊聊明天附近有什麼可以走走的地方。",
    "你在名古屋的機場櫃台，託運行李超重兩公斤。地勤會說明超重費用；你想問能不能把東西拿到手提、手提的限制是多少，並問登機門怎麼走、幾點開始登機。",
  ],
};

/**
 * A random seed brief for the language, preferring ones that have not yet
 * become a scenario on this device (`used` = the `source` fields of existing
 * scenarios). Once every seed has been used, any may come back.
 */
export function randomSeedBrief(
  language: TargetLanguage,
  used: Iterable<string | undefined>,
  rng: () => number = Math.random,
): string {
  const all = SEED_BRIEFS[language];
  const seen = new Set(used);
  const fresh = all.filter((b) => !seen.has(b));
  const pool = fresh.length ? fresh : all;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  return pool[i];
}
