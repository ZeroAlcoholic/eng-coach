// Built-in scenarios for the 33rd International Congress of Actuaries (ICA 2026,
// Tokyo, hosted by the Institute of Actuaries of Japan). Each one puts the
// learner in a different spot around the team's talks: fielding a hostile
// question, a bilateral meeting with IAJ, a hallway chat, a press interview,
// logistics with a session chair, a Japanese-language card exchange. The
// talk facts in each situation come from the team's own slides, so the
// learner rehearses with the numbers they will actually be asked about.
// Kept apart from defaults.ts so the conference set can be read, and later
// retired, as one unit; ids are stable for the same reason as every default.

import { FRAME_PRESETS, JA_CONGRESS_FRAME } from "./frames";
import type { Scenario } from "../../kernel/types";


export const ICA2026_SCENARIOS: { en: Scenario[]; ja: Scenario[] } = {
  en: [
    {
      id: "def-en-ica-governance-qa",
      title: "ICA 東京問答時間：被追問 AI 治理的風險分級",
      targetLanguage: "en",
      level: "B2",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "ICA 2026 東京大會的 AI 治理場次剛結束。你的同事報告了公司的風險分級架構：三十多個 AI 應用依「業務影響 × 模型風險」分成高、中、低三級，結果 91% 是低風險、6% 是高風險；每一級都要做公平性、穩健性與可解釋性檢核，高風險模型（例如自動核保）每年重新驗證並由高層簽核；目前治理流程大多還是人工，自動偵測偏誤與模型漂移是下一步。簡報沒有交代分級由誰評定。問答時間，荷蘭退休金精算師 Pieter Jansen 拿起麥克風：「91% low risk — who decided that? Isn't that the developers marking their own homework?」同事把麥克風交給你，主持人只給這題兩分鐘。",
      coachRole:
        "Pieter Jansen，荷蘭的退休金精算師，問題尖銳、重視獨立驗證，聽到具體做法會點頭，但可能再追問一題",
      userRole: "這篇報告的台灣共同作者，臨時接手回答台下提問",
      objectives: [
        "先感謝提問並用一句話重述問題，替自己爭取思考時間",
        "說明分級的依據：兩個維度，加上每一級都要做的標準檢核；不知道的細節，坦白說會確認後回覆",
        "用一個具體例子說明高風險模型受到更嚴的管控",
        "坦白承認這套架構還在補強的地方（治理仍以人工為主），不硬拗",
        "在時間內收尾，並邀對方會後再聊",
      ],
      targetPhrases: [
        "That's a fair challenge — thank you for raising it.",
        "If I understand correctly, you're asking who decides the risk tier.",
        "The tier is based on two dimensions: business impact and model risk.",
        "Every tier goes through the same checks: fairness by age and gender, robustness, and explainability.",
        "High-risk models, like automated underwriting, are revalidated every year with senior sign-off.",
        "To be honest, most of the governance is still manual — automating it is our next step.",
        "I'll confirm who signs off the tiering and get back to you.",
        "I'd be happy to walk you through the details after the session.",
      ],
    },
    {
      id: "def-en-ica-iaj-docai",
      title: "和日本精算學會代表會談：醫療文件 AI 與個資",
      targetLanguage: "en",
      level: "B1",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "ICA 2026 會期中的下午，日本精算學會（IAJ）AI 研究小組的 Kenji Watanabe 約你在會場的小會議室談三十分鐘。他看過你們團隊的 Doc AI 報告：多代理架構把核保用的醫療文件轉成結構化資料，辨識正確率從傳統 OCR 的 54.5% 提高到 93.1%。他最想知道：雲端模型碰到病歷這類個資時，你們怎麼裁切、遮罩、取得主管機關核准，這套做法搬到日本的個資規範下行不行得通。Watanabe 先生講話客氣、很少直接拒絕；他說「That might be a little difficult」時，意思其實就是行不通。",
      coachRole:
        "Kenji Watanabe，日本精算學會 AI 研究小組成員、日本壽險公司的精算師，禮貌謹慎、說話委婉，常用「maybe」「a little difficult」表達保留，會仔細追問細節",
      userRole: "台灣壽險公司資料與 AI 團隊的代表，向日方說明做法並探詢後續交流",
      objectives: [
        "用簡單的英文說明多代理架構的分工（前處理、地端模型、雲端模型）",
        "說明三種個資控管：只傳必要區塊、先遮罩、依主管機關核准使用",
        "聽出對方委婉的保留，追問他真正的顧慮",
        "提出一個對方容易接受的後續交流方式",
        "會談結尾確認雙方各自的下一步",
      ],
      targetPhrases: [
        "Thank you for taking the time to meet with us.",
        "In short, each agent does one job.",
        "One cleans the image, one handles sensitive data on-premise, and one reads complex documents in the cloud.",
        "We only send the parts of the document the task actually needs.",
        "Personal identifiers are masked before anything goes to a cloud model.",
        "When you say it might be difficult, is that mainly because of the regulations?",
        "Would it help if we shared our evaluation method rather than any data?",
        "Just to make sure I have this right — you'll check with your working group first?",
        "We'd be glad to continue the conversation online after the Congress.",
      ],
    },
    {
      id: "def-en-ica-iaj-education",
      title: "茶敘遇到日本同業：聊精算知識怎麼傳承",
      targetLanguage: "en",
      level: "B1",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "上午場次結束後的茶敘，日本壽險公司的精算師 Yuko Tanaka 端著茶走過來，她是日本精算學會教育委員會的成員。她剛聽完你們團隊的報告：把散落在投影片、手冊、錄影和會議紀錄裡的精算知識，用生成式 AI 加知識圖譜整理，再依職務推薦學習內容；AI 只提出標籤，專家審核通過才算數。她說日本也有資深精算師退休、經驗留不下來的問題，想知道你們實際怎麼起步。休息時間只剩十五分鐘，她還想問你台灣精算師考試的情況。",
      coachRole:
        "Yuko Tanaka，日本壽險公司的精算師、日本精算學會教育委員會成員，親切好奇，會分享日本的情況，也會反問你台灣的做法",
      userRole: "台灣壽險公司的與會者，熟悉這篇報告，想和日本同業交換經驗",
      objectives: [
        "自然地接話，用兩三句話介紹自己",
        "用淺白的話說明核心做法：AI 提標籤、專家審核、依職務推薦",
        "坦白說明目前的進度（推薦排序還在雛形階段）",
        "問對方日本的情況，並追問一個細節",
        "在休息結束前交換聯絡方式、約好之後分享資料",
      ],
      targetPhrases: [
        "Nice to meet you — how did you find the session?",
        "The idea is simple: AI suggests the tags, and our experts approve them.",
        "Only approved tags become part of the knowledge base.",
        "To be honest, the recommendation part is still a prototype.",
        "How do Japanese insurers pass on knowledge when senior actuaries retire?",
        "That's interesting — we're facing almost the same problem.",
        "Could I send you the slides after the Congress?",
        "I think the next session is starting — let's keep in touch.",
      ],
    },
    {
      id: "def-en-ica-ssr-backtest",
      title: "走廊被投資精算師追問：回測結果可信嗎？",
      targetLanguage: "en",
      level: "B2",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "你們團隊的 Stock Similar Radar 報告結束後，英國保險公司的資產負債管理精算師 Daniel Hughes 在走廊攔住你。報告的內容：用 TS2Vec 和生成式 AI 兩種方法，在 1997 到 2024 年的台股走勢裡找相似時段，再拿台指期回測；持有 15 天時，生成式 AI 的基準設定勝率 62.3%，調整參考時段數之後最高到 66.7%。Daniel 劈頭就問：「66.7% sounds too good. What about overfitting and transaction costs?」他懂統計，空泛的回答過不了他那關；但只要你講得誠實，他也很樂意給建議。",
      coachRole:
        "Daniel Hughes，英國保險公司的資產負債管理（ALM）精算師，懂統計、講話直接，會追問過度配適、交易成本與市場環境變化，也願意給具體建議",
      userRole: "這篇報告的台灣共同作者，在走廊回答同業追問",
      objectives: [
        "先承認對方問題的重點，不急著防衛",
        "說清楚研究證明了什麼、還沒證明什麼（模擬結果未含交易成本）",
        "用「勝率高不等於賺錢」的例子說明你們也看了報酬",
        "說明兩種方法結果不一致時的用途：提醒專家介入檢視",
        "請教對方的建議，並複述一個你要帶回團隊的方向",
      ],
      targetPhrases: [
        "You're right to push on that — it's the first thing we asked ourselves.",
        "These are simulated results; they don't include transaction costs or liquidity yet.",
        "A high win rate doesn't always mean profit. One setting had a 55.8% win rate and still lost points.",
        "We see it as a way to pick historical scenarios, not as a trading signal.",
        "When the two methods disagree, that's a flag for expert review.",
        "Strict walk-forward validation is next on our list.",
        "What would you need to see before you'd trust it?",
        "That's really helpful — I'll take that back to the team.",
      ],
    },
    {
      id: "def-en-ica-fraud-ethics",
      title: "詐騙風險評分：午餐桌上回應「這算不算年齡歧視」",
      targetLanguage: "en",
      level: "B2",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "反詐騙場次後的午餐圓桌，你旁邊坐著法國保險公司負責消費者保護的精算師 Claire Martin。她聽完你同事的報告：用機器學習替八百萬名客戶評估「下個月遭詐騙」的風險，分數最高的 5% 客戶涵蓋了 41% 的已知受害者，被標記的客戶在臨櫃或打客服時會收到防詐關懷。她放下叉子問你：受害者平均年長 7.4 歲，模型會不會等於在針對長者？客戶會不會因為一個分數就被擋下解約或貸款？她語氣溫和，但一定要聽到具體答案。",
      coachRole:
        "Claire Martin，法國保險公司負責消費者保護的精算師，語氣溫和但立場堅定，關心公平與客戶自主權，會追問具體做法",
      userRole: "台灣壽險公司的與會者，熟悉這個專案，在午餐桌上回應同業的疑慮",
      objectives: [
        "先肯定對方關心的問題，表示你們也重視",
        "說明模型的定位：提醒員工留意，決定由人來做",
        "說明任何交易限制都要依標準作業程序、經人工確認",
        "承認年齡相關的疑慮合理，不急著否認",
        "把對話帶到雙方都能分享的方向，例如怎麼衡量關懷的成效",
      ],
      targetPhrases: [
        "That's an important question, and we take it seriously.",
        "The score doesn't make decisions — it tells staff where to pay attention.",
        "No transaction is restricted by the model alone; it always goes through human review.",
        "The goal is to protect customers before the money is gone, not to block them.",
        "Age is one of over three hundred variables, and we should check how much it drives the score.",
        "I think that's a fair concern, and it's worth monitoring closely.",
        "How do insurers in France handle situations like this?",
      ],
    },
    {
      id: "def-en-ica-policyqa-regulator",
      title: "保單問答 AI：向監理官說明「什麼時候會拒答」",
      targetLanguage: "en",
      level: "B1",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "大會的交流晚會上，東南亞一家保險監理機關的監理官 Alicia Wong 拿著飲料來找你。她對你們團隊的保單條款問答系統很有興趣：系統只在選定的商品範圍內找條款，每個回答都附上條款出處，再由兩個 AI 評審檢查正確性與完整性；證據不夠時，系統會請使用者補充，或直接拒答。專家出的一千多題測試裡，正確率超過九成。她最想知道的是：什麼時候能讓一般保戶直接用？你知道答案是「還不行」，而且得說出原因。",
      coachRole:
        "Alicia Wong，東南亞某國保險監理機關的監理官，友善但問題實際，最關心消費者會不會被誤導、出錯時誰負責",
      userRole: "台灣壽險公司的與會者，向監理官說明這套系統的用途與界線",
      objectives: [
        "用一兩句話說明系統做什麼、給誰用",
        "說明系統怎麼避免亂答：限定商品、附條款出處、AI 評審、證據不足就拒答",
        "誠實回答何時開放給保戶：目前還不行，並說出條件",
        "說明重大錯誤（金額、資格、除外條款）會另外追蹤",
        "禮貌收尾，表示歡迎監理單位提供意見",
      ],
      targetPhrases: [
        "Right now it's an internal tool — it supports our actuaries, not customers.",
        "Every answer comes with the exact policy clause it's based on.",
        "If the evidence isn't there, it asks for clarification or refuses to answer.",
        "If it isn't sure, it says so or doesn't answer — it never guesses.",
        "Correctness was above ninety percent, but only within the products we tested.",
        "Opening it to policyholders would need new tests and a clear owner.",
        "We'd really welcome feedback from a regulator's point of view.",
      ],
    },
    {
      id: "def-en-ica-press-interview",
      title: "接受保險業媒體採訪：三分鐘講懂業務員的 AI 助手",
      targetLanguage: "en",
      level: "B1",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "大會的媒體區，一家亞洲保險業刊物的記者 Grace Lee 想做一段三分鐘的訪問，主題是你們團隊的「From Models to Clients」報告：生成式 AI 把客戶手上所有保單整理成一張保障全貌，搭配公司核可過的資料，替業務員準備和客戶談話的草稿；試行時，調閱保障資料與整理客戶資料的時間平均省下兩到三成。Grace 的讀者大多是通路主管，她要白話，也要一句能當標題的話；她還會故意問：「So AI is selling insurance now?」你要講得生動，但不能誇大。",
      coachRole:
        "Grace Lee，亞洲保險業刊物的記者，節奏快、喜歡追一句話的結論，會丟出帶點挑釁的問題測試你",
      userRole: "台灣壽險公司的代表，接受簡短的媒體訪問",
      objectives: [
        "用一句白話說明這個工具解決什麼問題",
        "舉一個業務員使用前後的對比",
        "澄清誤解：AI 準備資料，和客戶談的仍是業務員",
        "說明品質怎麼把關（核可的資料、AI 評審、人工抽查）",
        "給記者一句簡短、好引用的總結",
      ],
      targetPhrases: [
        "Simply put, it helps agents see a client's whole coverage in one place.",
        "Before, agents spent a lot of time hunting for materials.",
        "Now they can spend that time actually talking to the client.",
        "No — the AI prepares the draft; the agent has the conversation.",
        "It only uses content the company has already approved.",
        "If human reviewers disagree with the AI check on ten percent of samples, we switch to full human review.",
        "If I had to put it in one line: less time searching, better conversations.",
      ],
    },
    {
      id: "def-en-ica-llm-qa-advice",
      title: "同業請教：LLM 專案品質檢核怎麼導入",
      targetLanguage: "en",
      level: "B1",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "LLM 品質保證場次結束後，印尼一家壽險公司的風控長 Budi Santoso 在門口叫住你。你同事剛報告了公司的 LLM 專案檢核架構：精準與穩定兩大支柱，在專案的早、中、晚三個階段把關，已套用在二十多個專案；案例是用地端模型加規則，把醫囑轉成理賠欄位，3,000 筆驗證的正確率 0.90，同一批資料重跑結果幾乎一樣。Budi 想回去照著做，問題很實際：要幾個人、業務單位嫌麻煩怎麼辦、第一步做什麼。他英文帶口音，講得很快。",
      coachRole:
        "Budi Santoso，印尼壽險公司的風控長，務實、急著把方法帶回去用，英文帶口音、語速快，會一直追問「實際上怎麼做」",
      userRole: "台灣壽險公司的與會者，熟悉這套檢核流程，分享實務經驗",
      objectives: [
        "聽不清楚口音或語速太快時，請對方放慢或換個說法",
        "用三個階段簡單說明檢核發生在專案流程的哪裡",
        "給一個具體的起步建議：開發前先訂好門檻與驗證資料",
        "回應「業務單位嫌麻煩」：說明早期把關反而省成本",
        "結尾確認之後要提供哪些資料，不確定能否分享的先說會確認",
      ],
      targetPhrases: [
        "Sorry, could you say that a little more slowly?",
        "We check every project at three points: early, mid and late.",
        "The most important thing is to agree on the threshold before you build anything.",
        "That way, the standard can't move to fit the result.",
        "Most problems show up early, and that's when they're cheapest to fix.",
        "We re-ran the same three thousand cases and got almost the same accuracy.",
        "Let me check whether I can share our checklist, and I'll get back to you.",
      ],
    },
    {
      id: "def-en-ica-session-chair",
      title: "上台前和場次主持人對流程：時間被砍了",
      targetLanguage: "en",
      level: "B1",
      baseContext: FRAME_PRESETS.en,
      contentContext:
        "場次開始前二十分鐘，你陪同事到講者休息室報到。今天的主持人、德國精算師 Helen Fischer 拿著流程表過來：前一場延誤，每位講者從二十分鐘縮成十五分鐘，問答只剩一題。她還要確認講者的名字怎麼唸、介紹時要說哪一句、投影片用自己的筆電還是會場電腦。你的同事還在改投影片，溝通都落在你身上；你想替同事多爭取兩分鐘。",
      coachRole:
        "Helen Fischer，德國精算師、這個場次的主持人，有效率、守時，願意配合但時間很緊，會一項一項確認",
      userRole: "陪同事上台的台灣團隊成員，負責和主持人確認流程",
      objectives: [
        "確認新的時間安排並複述一次",
        "教主持人正確唸出同事的名字",
        "提供一句簡短的講者介紹",
        "禮貌地爭取多一點時間，或提出彈性做法（例如問答移到會後）",
        "確認投影片、計時提示等技術細節",
      ],
      targetPhrases: [
        "Just to confirm — we now have fifteen minutes, including Q&A?",
        "Let me say my colleague's name slowly for you.",
        "You could introduce my colleague as a data scientist on our data and AI team.",
        "Is there any chance we could have two extra minutes?",
        "If time is tight, we're happy to take questions after the session.",
        "Could you give us a signal when there are three minutes left?",
        "We'll use the venue computer — the slides are on this USB drive.",
      ],
    },
  ],
  ja: [
    {
      id: "def-ja-ica-meishi",
      title: "精算大會歡迎晚會：用日語交換名片寒暄",
      targetLanguage: "ja",
      level: "A2",
      baseContext: JA_CONGRESS_FRAME,
      contentContext:
        "ICA 2026 東京大會的歡迎晚會，日本精算學會的會員鈴木さん走過來打招呼，他是日本壽險公司的精算師。你想用日語完成一輪名片交換：自我介紹、說你從台灣來、在哪個部門，再簡單說一句你們團隊這次有報告，最後道別。鈴木さん聽到你講日語很高興，會放慢速度，也可能突然問你來過東京幾次。",
      coachRole:
        "鈴木さん，日本精算學會會員、日本壽險公司的精算師，客氣有禮，講日語時會放慢，會用簡單的問題延續話題",
      userRole: "來東京參加國際精算大會的台灣與會者",
      objectives: [
        "用日語打招呼，說出自己的名字與公司",
        "遞名片並說一句得體的話",
        "用簡單的日語說明你們團隊這次有報告",
        "回答對方一個簡單的問題（例如來過東京幾次）",
        "得體地道別",
      ],
      targetPhrases: [
        "はじめまして。台湾から来ました。",
        "〇〇と申します。",
        "台湾の生命保険会社で働いています。",
        "こちら、私の名刺です。",
        "どうぞよろしくお願いいたします。",
        "私たちのチームも発表させていただきます。",
        "東京は二回目です。",
        "お会いできてうれしいです。",
        "では、失礼いたします。",
      ],
    },
  ],
};
