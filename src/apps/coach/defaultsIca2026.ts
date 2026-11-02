// Built-in scenarios for the 33rd International Congress of Actuaries (ICA 2026,
// Tokyo, hosted by the Institute of Actuaries of Japan): the places a learner
// talks in around a congress, some about the team's own talks and some not.
// Every scene runs in discussion mode: the situation carries only the gist of
// a talk as shared background, prompt.ts tells the coach to share views and
// never quiz the learner on facts, and target phrases carry no figures, so a
// learner who remembers only the main idea can still take part.
// Kept apart from defaults.ts so the conference set can be read, and later
// retired, as one unit; ids are stable for the same reason as every default.

import { EN_CONGRESS_FRAME, JA_CONGRESS_FRAME } from "./frames";
import type { Scenario } from "../../kernel/types";

export const ICA2026_SCENARIOS: { en: Scenario[]; ja: Scenario[] } = {
  en: [
    {
      id: "def-en-ica-governance-qa",
      title: "ICA 東京問答時間：聊聊 AI 應用怎麼分級管理",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "ICA 2026 東京大會的 AI 治理場次剛結束。你的同事報告了公司怎麼把三十多個 AI 應用，依「對業務的影響」和「模型本身的風險」分成高、中、低三級：大部分是低風險，少數高風險的（例如自動核保）管得最嚴。問答時間，荷蘭退休金精算師 Pieter Jansen 舉手：他們公司也在想怎麼分級，好奇你們實際怎麼判斷，做起來辛不辛苦。同事把麥克風遞給你。你記得大方向就夠了，細節想不起來，可以說會後再確認。",
      coachRole:
        "Pieter Jansen，荷蘭的退休金精算師，好奇又務實，會分享他們公司的做法，可能溫和地追問一題",
      userRole: "和報告人同團隊的台灣同事，替報告人接下一題台下提問",
      objectives: [
        "感謝提問，用自己的話重述對方的問題",
        "用大方向說明分級的想法：影響越大、管得越嚴",
        "分享你自己對這種做法的看法（好處或難處）",
        "反問對方公司是怎麼做的",
        "想不起細節時坦白說會後確認，自然收尾",
      ],
      targetPhrases: [
        "Thanks for the question — it's something we thought about a lot.",
        "So, if I understand correctly, you're asking how we decide the level?",
        "The basic idea is simple: the bigger the impact, the closer we look.",
        "Most of our tools are low risk, so we focus on the few that matter.",
        "Personally, I think the hard part is keeping it up to date.",
        "How does your company handle this?",
        "I don't remember the exact details, but I can check and get back to you.",
      ],
    },
    {
      id: "def-en-ica-iaj-docai",
      title: "和日本精算學會代表喝咖啡：聊醫療文件 AI 與個資",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "ICA 2026 會期中的下午，日本精算學會（IAJ）的會員 Kenji Watanabe 約你在會場咖啡廳聊半小時。他聽過你們團隊的 Doc AI 報告：讓好幾個 AI 分工讀核保用的醫療文件，敏感資料留在公司內部處理，要交給雲端模型前，先把個人資料裁切或遮住。他想聽聽台灣和日本在病歷與個資的規範上有什麼不同，也想分享日本同業的顧慮。Watanabe 先生講話客氣、很少直接拒絕；他說「That might be a little difficult」時，代表真的有困難，值得溫和地追問一句。",
      coachRole:
        "Kenji Watanabe，日本精算學會會員、日本壽險公司的精算師，禮貌謹慎、說話委婉，常用「maybe」「a little difficult」表達保留，樂於分享日本的情況",
      userRole: "台灣壽險公司資料與 AI 團隊的成員，和日方交換經驗",
      objectives: [
        "寒暄並感謝對方的邀約",
        "用簡單的話說明大方向：敏感資料留在內部，送出去前先遮掉",
        "聊聊台灣這邊的顧慮，並問日本的情況",
        "聽出對方委婉的保留，溫和地追問原因",
        "約好之後怎麼繼續交流",
      ],
      targetPhrases: [
        "Thank you for inviting me — it's nice to talk outside the sessions.",
        "The main idea is that sensitive data stays inside the company.",
        "Before anything goes to a cloud model, we hide the personal details.",
        "In Taiwan, the rules on medical data are pretty strict. How about in Japan?",
        "When you say it might be difficult, what's the main concern?",
        "That's a good point. I hadn't thought about it that way.",
        "Maybe we could keep in touch and compare notes after the Congress?",
      ],
    },
    {
      id: "def-en-ica-iaj-education",
      title: "茶敘遇到日本同業：聊精算知識怎麼傳承",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "上午場次結束後的茶敘，日本壽險公司的精算師 Yuko Tanaka 端著茶走過來，她也是日本精算學會的會員，很關心精算教育。她剛聽完你們團隊的報告：把散落在投影片、手冊、錄影和會議紀錄裡的精算知識，用生成式 AI 整理、貼上標籤，由專家審核；依每個人的工作推薦該讀的內容，則是下一步還在設計的部分。她說日本也有資深精算師退休、經驗留不下來的煩惱，想聽聽你的看法。休息時間只剩十五分鐘，她還好奇台灣的精算師怎麼準備考試。",
      coachRole:
        "Yuko Tanaka，日本壽險公司的精算師、日本精算學會會員，關心精算教育，親切好奇，會分享日本的情況，也會反問你台灣的做法",
      userRole: "台灣壽險公司的與會者，想和日本同業交換經驗",
      objectives: [
        "自然地接話，用兩三句話介紹自己",
        "用淺白的話說說這套做法想解決的問題",
        "分享你自己的經驗：新人學東西最卡在哪裡",
        "問對方日本的情況，並接著聊下去",
        "休息結束前交換聯絡方式",
      ],
      targetPhrases: [
        "Nice to meet you — how did you find the session?",
        "The problem is that knowledge is everywhere, but hard to find when you need it.",
        "AI suggests the tags, and our experts check them.",
        "In my experience, new colleagues mostly struggle to know where to start.",
        "How do Japanese insurers pass on knowledge when senior actuaries retire?",
        "That's interesting — it sounds like we have the same problem.",
        "I think the next session is starting — shall we exchange cards?",
      ],
    },
    {
      id: "def-en-ica-ssr-backtest",
      title: "走廊聊投資 AI：找歷史相似走勢，能信到什麼程度？",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "你們團隊的 Stock Similar Radar 報告結束後，英國保險公司的資產負債管理精算師 Daniel Hughes 在走廊和你聊起來。報告的大意：用兩種 AI 方法，在台股二十多年的走勢裡找出和現在最像的時段，再看那些時段之後怎麼走；回測結果不錯，但團隊自己也說那是模擬，還沒算交易成本。Daniel 對這個點子很感興趣，想聊聊它能不能幫精算師挑壓力情境，也想知道你覺得它可以信到什麼程度。",
      coachRole:
        "Daniel Hughes，英國保險公司的資產負債管理（ALM）精算師，懂統計、說話直接但友善，會分享他對模型風險的看法，也願意給建議",
      userRole: "這篇報告的台灣共同作者，在走廊和同業交流",
      objectives: [
        "用一兩句白話說明這個工具在做什麼",
        "誠實說明結果的限制：模擬結果，還沒算交易成本",
        "分享你對「AI 提供參考、人來判斷」的看法",
        "接著對方的想法延伸討論（例如拿來挑壓力情境）",
        "請教對方的建議並道謝",
      ],
      targetPhrases: [
        "In simple terms, it looks for past periods that look like today's market.",
        "The results looked promising, but they're simulations — no trading costs yet.",
        "A high win rate doesn't always mean you make money.",
        "I see it more as a starting point for discussion than an answer.",
        "That's an interesting idea — using it to choose stress scenarios.",
        "What would you want to see before you'd trust it?",
        "Thanks, that's really useful. I'll share it with the team.",
      ],
    },
    {
      id: "def-en-ica-fraud-ethics",
      title: "午餐桌聊防詐：保護客戶與尊重客戶的界線",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "反詐騙場次後的午餐圓桌，你旁邊坐著法國保險公司負責消費者保護的精算師 Claire Martin。她聽完你同事的報告：用機器學習找出比較可能被詐騙的客戶，客戶到臨櫃或打客服時，由同仁多關心一句、提醒防詐；模型只負責提醒，決定都由人做。Claire 很欣賞這個想法，但也想聊聊：受害者的平均年紀比較大，怎麼保護他們又不讓他們覺得被針對？保護客戶和尊重客戶自己的決定，界線在哪裡？",
      coachRole:
        "Claire Martin，法國保險公司負責消費者保護的精算師，語氣溫和，關心公平與客戶自主權，會分享法國的經驗",
      userRole: "台灣壽險公司的與會者，在午餐桌上和同業聊這個專案",
      objectives: [
        "用白話說明這個專案想做的事：提早提醒、保護客戶",
        "說明模型只是提醒同仁，決定還是由人做",
        "分享你對「保護」和「尊重客戶決定」的看法",
        "問對方法國的做法或經驗",
        "在輕鬆的氣氛中收尾",
      ],
      targetPhrases: [
        "The idea is to reach customers before the money is gone.",
        "The model doesn't decide anything — it tells staff who to look out for.",
        "Our staff always decide in the end.",
        "I think it's a balance between protecting people and respecting their choices.",
        "That's a fair concern. Older customers shouldn't feel targeted.",
        "How do insurers in France approach this?",
      ],
    },
    {
      id: "def-en-ica-policyqa-regulator",
      title: "交流晚會遇到監理官：聊保單問答 AI 何時能給保戶用",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "大會的交流晚會上，東南亞一家保險監理機關的監理官 Alicia Wong 拿著飲料來找你。她聽說你們團隊做了保單條款問答系統：只在指定商品的條款裡找答案，每個回答都附上出處；沒把握時會請使用者說清楚，或乾脆不回答。目前只給公司內部的精算同仁用。她好奇的是：要做到什麼程度，才放心讓一般保戶直接用？出錯時誰負責？你們也還在想這些問題，正好可以交換意見。",
      coachRole:
        "Alicia Wong，東南亞某國保險監理機關的監理官，友善、問題實際，最關心消費者會不會被誤導，也樂於分享監理的角度",
      userRole: "台灣壽險公司的與會者，和監理官交換意見",
      objectives: [
        "用一兩句話說明系統做什麼、目前給誰用",
        "說明系統怎麼避免亂答：附出處、沒把握就不答",
        "分享你的看法：開放給保戶之前還需要什麼",
        "請教對方從監理角度最在意什麼",
        "禮貌收尾，表示歡迎對方提供意見",
      ],
      targetPhrases: [
        "Right now it's an internal tool — it helps our actuaries, not customers.",
        "Every answer shows which policy clause it comes from.",
        "If it isn't sure, it says so or doesn't answer — it never guesses.",
        "Before customers use it, we'd need more testing and someone clearly responsible.",
        "From a regulator's side, what would you look for first?",
        "That's helpful. I think we see it the same way.",
      ],
    },
    {
      id: "def-en-ica-press-interview",
      title: "接受保險業媒體採訪：三分鐘講懂業務員的 AI 助手",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "大會的媒體區，一家亞洲保險業刊物的記者 Grace Lee 想做一段三分鐘的輕鬆訪問，主題是你們團隊的「From Models to Clients」報告：生成式 AI 把客戶手上所有保單整理成一張保障全貌，搭配公司核可過的資料，替業務員準備和客戶談話的重點，讓業務員少花時間找資料、多花時間和客戶聊。Grace 的讀者大多是通路主管，她要的是白話，最好有一句能當標題的話；她也會半開玩笑地問：「So AI is selling insurance now?」",
      coachRole:
        "Grace Lee，亞洲保險業刊物的記者，節奏快、愛開玩笑，喜歡追一句話的結論，也會問你個人的看法",
      userRole: "台灣壽險公司的代表，接受簡短的媒體訪問",
      objectives: [
        "用一句白話說明這個工具解決什麼問題",
        "舉一個業務員使用前後的對比",
        "輕鬆回應玩笑：AI 準備資料，和客戶談的仍是業務員",
        "分享你個人對 AI 和業務員關係的看法",
        "給記者一句簡短、好引用的總結",
      ],
      targetPhrases: [
        "Simply put, it helps agents see a client's whole coverage in one place.",
        "Before, agents spent a lot of time looking for materials.",
        "Now they can spend that time actually talking to the client.",
        "Not quite — the AI prepares the notes; the agent has the conversation.",
        "It only uses content the company has already approved.",
        "Personally, I think the human part of the job matters even more now.",
        "If I had to put it in one line: less time searching, better conversations.",
      ],
    },
    {
      id: "def-en-ica-llm-qa-advice",
      title: "同業請教：LLM 專案品質怎麼把關",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "LLM 品質保證場次結束後，印尼一家壽險公司的風控長 Budi Santoso 在門口叫住你。你同事剛報告了公司怎麼替 LLM 專案把關：在專案的開始、中期、上線前後三個時間點檢查「答得準不準」和「每次答得一不一樣」，已經用在二十多個專案上。Budi 想回去試試，問題很實際：業務單位嫌麻煩怎麼辦？第一步做什麼？你們自己遇過什麼困難？他英文帶口音，講得很快。",
      coachRole:
        "Budi Santoso，印尼壽險公司的風控長，務實熱情，想把方法帶回去用，英文帶口音、語速快，會分享印尼那邊的情況",
      userRole: "台灣壽險公司的與會者，和同業分享實務經驗",
      objectives: [
        "聽不清楚口音或語速太快時，請對方放慢或換個說法",
        "用自己的話說說大概在專案的哪些時候做檢查",
        "分享一個你覺得最重要的起步建議",
        "聊聊你們遇過的困難，以及怎麼說服業務單位",
        "結尾確認之後怎麼聯絡，不確定能分享的資料先說會確認",
      ],
      targetPhrases: [
        "Sorry, could you say that a little more slowly?",
        "We check each project at the start, in the middle, and near launch.",
        "First, agree on what 'good enough' means before you build.",
        "Most problems show up early, and that's when they're cheapest to fix.",
        "I imagine some teams might find it slow at first.",
        "We run the same cases again to make sure the answers stay the same.",
        "Let me check what I can share, and I'll get back to you.",
      ],
    },
    {
      id: "def-en-ica-session-chair",
      title: "上台前和場次主持人對流程：時間被砍了",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
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
    {
      id: "def-en-ica-ask-speaker",
      title: "在別人的場次台下提問：氣候變遷與死亡率",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "你走進一場和自己團隊無關的場次：加拿大精算師 Emily Carter 剛報告完「氣候變遷對死亡率假設的影響」，講到熱浪和空污會怎麼改變長期的死亡率趨勢。主持人開放提問，你想問她：像台灣這種夏天越來越熱、人口又快速老化的地方，她的方法用得上嗎？台下還有人排隊，你只有一次發問機會，可以再追問一小句。Emily 回答得很熱心，也會反問你台灣的情況。",
      coachRole:
        "Emily Carter，加拿大的精算師、這個場次的講者，熱心回答提問，會用簡單的例子說明，也會反問台灣的情況",
      userRole: "台下的台灣與會者，想向講者提一個問題",
      objectives: [
        "先簡短感謝講者，再說出自己的名字和來自哪裡",
        "用一兩句話清楚提出問題",
        "沒完全聽懂回答時，請對方換個說法或舉例",
        "回答講者反問的台灣情況",
        "道謝並把麥克風交回",
      ],
      targetPhrases: [
        "Thank you for a really interesting talk.",
        "I'm from Taiwan, where summers are getting hotter every year.",
        "Do you think your approach would work in a fast-ageing country?",
        "Sorry, could you give an example of what you mean?",
        "In Taiwan, the population is ageing very quickly.",
        "That's very helpful. Thank you.",
      ],
    },
    {
      id: "def-en-ica-gala-dinner",
      title: "大會晚宴：和日本精算師聊東京生活，再得體離席",
      targetLanguage: "en",
      level: "B1",
      mode: "discussion",
      baseContext: EN_CONGRESS_FRAME,
      contentContext:
        "大會晚宴上，你被安排坐在日本精算師 Takeshi Mori 旁邊。今晚不談工作：他住在東京，很樂意推薦明天下午可以去走走的地方、哪裡有好吃的居酒屋，也好奇台灣人週末都做什麼。聊到一半，你的同事在遠處向你招手，約好要一起搭最後一班接駁車回飯店；你要找個自然的時機，有禮貌地結束對話離席。",
      coachRole:
        "Takeshi Mori，住在東京的日本精算師，健談幽默，喜歡聊美食和散步路線，也會問你台灣的生活",
      userRole: "第一次來東京參加大會的台灣與會者",
      objectives: [
        "主動開個輕鬆的話題（例如今晚的菜或這幾天的天氣）",
        "請對方推薦東京值得去的地方，並追問怎麼去",
        "分享一件你在台灣週末喜歡做的事",
        "聽到不熟的地名或說法時，請對方再說一次或拼一下",
        "找到自然的時機，有禮貌地結束對話離席",
      ],
      targetPhrases: [
        "This looks delicious. Have you tried this dish before?",
        "If I have a free afternoon tomorrow, where should I go?",
        "How do I get there from here?",
        "Sorry, could you say the name of that place again?",
        "On weekends, I usually go hiking near Taipei.",
        "It's been really nice talking to you.",
        "I'm afraid I have to go — my colleagues are waiting for the shuttle.",
      ],
    },
  ],
  ja: [
    {
      id: "def-ja-ica-meishi",
      title: "精算大會歡迎晚會：用日語交換名片寒暄",
      targetLanguage: "ja",
      level: "A2",
      mode: "discussion",
      baseContext: JA_CONGRESS_FRAME,
      contentContext:
        "ICA 2026 東京大會的歡迎晚會，日本精算學會的會員鈴木さん走過來打招呼，他是日本壽險公司的精算師。你想用日語完成一輪名片交換：自我介紹、說你從台灣來、在哪個部門，再簡單說一句你們團隊這次有報告，最後道別。鈴木さん聽到你講日語很高興，會放慢速度，也可能突然問你來過東京幾次。",
      coachRole:
        "鈴木さん，日本精算學會會員、日本壽險公司的精算師，客氣有禮，講日語時會放慢，會用簡單的問題延續話題",
      userRole: "來東京參加國際精算大會的台灣與會者",
      objectives: [
        "用日語打招呼，說出自己的名字與公司",
        "遞名片、收下對方名片，各說一句得體的話",
        "用簡單的日語說明你們團隊這次有報告",
        "回答對方一個簡單的問題（例如來過東京幾次）",
        "得體地道別",
      ],
      targetPhrases: [
        "はじめまして。台湾から来ました。",
        "〇〇と申します。",
        "台湾の生命保険会社で働いています。",
        "こちら、私の名刺です。",
        "頂戴します。",
        "どうぞよろしくお願いいたします。",
        "私たちのチームは今回、発表があります。",
        "東京は〇回目です。",
        "お会いできてうれしいです。",
        "では、失礼いたします。",
      ],
    },
  ],
};
