// S4 — built-in demo story arcs, so the narrative pull is available without
// authoring anything. English: four business lines set in the 2026 workplace
// (adopting, governing, presenting and co-building AI systems — the situations a
// Taiwanese finance professional actually walks into). Japanese: two travel
// lines (Tokyo, then Kansai). Each ≤6 episodes.
//
// Only EPISODE 1 is authored. Episodes 2–6 are generated on the normal
// end-of-episode path, kept on the designed shape by `outline` and drawing on the
// same `storyState` seed — so the story still reacts to what the learner actually
// said, instead of replaying a script. Stable ids (like DEFAULT_SCENARIOS) mean
// installing twice leaves one arc, and an installed arc drops out of the list.
// Retired arcs keep working for anyone who installed them: an installed arc is
// its own record and never reads this file again.

import type { DemoArc } from "./arcs";
import type { TargetLanguage } from "../../kernel/types";

export const DEFAULT_ARCS: Record<TargetLanguage, DemoArc[]> = {
  en: [
    {
      id: "def-arc-en-ai-service-agent",
      title: "導入 AI 客服助理：從供應商評選到上線",
      targetLanguage: "en",
      level: "B1",
      premise:
        "你是保險公司客服部門的專案負責人，公司決定導入一套 AI 客服助理（agent）來處理保單查詢與理賠進度。供應商的解決方案主管 Maya Chen 負責對接，法遵同事 Tom 盯著個資與資料存放，你的主管 Karen 要的是上線日期和風險說得清楚。這條線從供應商展示會的提問開始，一路走到試營運出包、向高層說明，最後上線與回顧。",
      plannedEpisodes: 6,
      canDos: [
        "能在供應商展示會後針對資料存放、幻覺與費用提出具體問題",
        "能與內部團隊對齊專案範圍、KPI 與各自分工",
        "能在法遵審查中用簡單的英文說明資料如何流動並回答疑慮",
        "能描述一次 AI 答錯的客訴案例並提出處置方式",
        "能向高層簡報上線建議，並坦白說明剩餘風險",
        "能在回顧會議中肯定做得好的部分並提出下一步改善",
        "能在協商費用或範圍時禮貌但堅定地守住底線",
      ],
      outline: [
        "供應商展示會：聽 Maya 介紹 AI 客服助理，針對資料存放、幻覺、費用提問",
        "內部 kickoff：和團隊對齊範圍、KPI 與分工，Karen 追問上線日期",
        "法遵審查會議：向 Tom 說明資料流與個資處理，回答他的疑慮",
        "試營運檢討：一件 AI 答錯保單條款的客訴，要和 Maya 討論處置與修正",
        "向高層簡報：提出上線建議、剩餘風險與備援計畫，接受追問",
        "上線後回顧：與供應商季度會議，肯定成果、協商下一階段費用與範圍",
      ],
      storyState: {
        characters: [
          { name: "Maya Chen", note: "供應商的解決方案主管，反應快、很會賣，但對細節會含糊帶過" },
          { name: "Tom Lin", note: "公司法遵，謹慎、講求書面證據，最在意個資去了哪裡" },
          { name: "Karen Wu", note: "你的主管，只想聽日期、風險與要不要做" },
        ],
        events: [],
        openThreads: [
          "供應商還沒說清楚客戶資料會存在哪個區域、保留多久",
          "Karen 已經對外承諾第三季要上線，你還不確定做不做得到",
        ],
      },
      episode1: {
        title: "供應商展示會：問清楚資料去哪裡",
        contentContext:
          "供應商剛做完 AI 客服助理的展示：能查保單、回答理賠進度、轉真人客服。現在是問答時間，你代表客服部門提問。你要問清楚客戶資料存在哪裡、會不會拿去訓練模型、AI 答錯（幻覺）時怎麼處理、費用怎麼算，並請對方用例子說明。Maya 會盡量往好處講，你要追問到具體答案。",
        coachRole: "供應商的解決方案主管 Maya Chen：熱情、口條好，遇到細節會先給籠統答案，被追問才說具體",
        userRole: "保險公司客服部門的專案負責人，第一次和這家供應商正式對談",
        objectives: [
          "問清楚客戶資料存放的地區與保留期限，並確認會不會用來訓練模型",
          "問 AI 回答錯誤時的處理機制，並要求一個具體例子",
          "問費用怎麼計算，並請對方說明超量使用的收費",
          "在得到籠統答案時禮貌地追問，直到聽到具體答案",
        ],
        targetPhrases: [
          "Where is our customer data stored, and for how long?",
          "Will our data be used to train your model?",
          "What happens when the assistant gives a wrong answer?",
          "Could you walk me through a concrete example?",
          "How is the pricing calculated — per conversation or per seat?",
          "Sorry, I need something more specific than that.",
          "Just to confirm, you're saying the data never leaves Taiwan?",
          "Let me make sure I understood you correctly.",
        ],
        recap: "你的部門要導入 AI 客服助理，今天是供應商展示會的問答時間。主管等著你帶回具體答案，尤其是客戶資料到底存在哪裡。",
        canDoIndexes: [1],
      },
    },
    {
      id: "def-arc-en-ai-governance-audit",
      title: "AI 治理稽核週：向區域總部說明模型風險",
      targetLanguage: "en",
      level: "B2",
      premise:
        "區域總部派了 AI 治理稽核小組來台北一週，領隊是嚴謹的 Sophie Laurent，她要看你們部門用了哪些模型、怎麼管、出過什麼事。你是負責回答的人：從稽核範圍、模型清單、偏誤與可解釋性，到一次錯誤輸出的事件重演，最後談改善計畫與結案。這一週說得清楚，年底的區域評等就過關。",
      plannedEpisodes: 6,
      canDos: [
        "能在開場會議確認稽核範圍、時程與需要準備的文件",
        "能有條理地說明部門使用的模型清單、用途與負責人",
        "能在被追問偏誤與可解釋性時，用證據回答而不是辯解",
        "能重演一次事件：發生了什麼、怎麼發現、怎麼處置",
        "能提出改善計畫並協商合理的完成時程",
        "能在結案會議摘要共識、確認後續追蹤並得體收尾",
        "能在不確定時坦白說「我需要查證後回覆」而不亂答",
      ],
      outline: [
        "開場會議：稽核小組說明範圍與時程，你確認需要準備的文件與窗口",
        "模型清單：逐一說明部門用的模型、用途、資料來源與負責人",
        "深入追問：Sophie 追問偏誤、可解釋性與人工覆核的比例",
        "事件重演：一次模型錯誤輸出影響客戶的事件，說明發現與處置",
        "改善計畫：提出補強措施，協商完成時程與資源",
        "結案會議：摘要發現與共識，確認追蹤機制，禮貌收尾",
      ],
      storyState: {
        characters: [
          { name: "Sophie Laurent", note: "區域總部 AI 治理稽核領隊，冷靜、追根究柢，討厭含糊的形容詞" },
          { name: "Raj Mehta", note: "稽核小組的技術成員，友善，喜歡看實際的紀錄與儀表板" },
        ],
        events: [],
        openThreads: [
          "上一季有一次模型輸出錯誤影響了幾位客戶，稽核小組一定會問",
          "部門的模型清單還沒完全更新，有兩個工具沒有正式負責人",
        ],
      },
      episode1: {
        title: "開場會議：確認稽核範圍",
        contentContext:
          "稽核小組第一天早上的開場會議。Sophie 會說明這一週要看什麼、想見誰、要哪些文件，並問你部門目前的 AI 使用概況。你要聽懂範圍、確認時程、把還沒準備好的文件說清楚（不誇大也不隱瞞），並約定每天的對接方式。",
        coachRole: "稽核領隊 Sophie Laurent：客氣但直接，每一句都在確認事實，會把你說的話重述一遍要你確認",
        userRole: "台北部門負責回應稽核的資深專員",
        objectives: [
          "聽懂並重述稽核的範圍與這一週的時程",
          "說明部門目前使用 AI 的概況（幾個工具、做什麼用）",
          "坦白說明哪些文件已備妥、哪些還需要幾天",
          "約定每天對接的時間與窗口",
        ],
        targetPhrases: [
          "So the scope covers all customer-facing models, is that right?",
          "We currently use three AI tools in this department.",
          "The model inventory is ready; the incident log needs two more days.",
          "I'd rather check and get back to you than guess.",
          "Who should I send the documents to?",
          "Could we do a fifteen-minute check-in every morning?",
          "Let me summarise what we've agreed.",
          "Is there anything else you'd like us to prepare?",
        ],
        recap: "區域總部的 AI 治理稽核小組今天抵達台北，領隊 Sophie 要看你們的模型清單和上一季那次出錯的事件。第一關是開場會議：把範圍和時程確認清楚。",
        canDoIndexes: [1, 7],
      },
    },
    {
      id: "def-arc-en-ai-conference",
      title: "國際 AI 研討會出差：發表、提問、建立人脈",
      targetLanguage: "en",
      level: "B1",
      premise:
        "公司派你到新加坡參加為期三天的金融 AI 國際研討會，任務有三個：代表公司做一場十分鐘的短講、在別人的演講後提出好問題、認識幾位可能合作的人。你會一再遇到同一批人：主持人 Ben、荷蘭來的講者 Anneke、還有對你們做法很好奇的印尼銀行主管 Dewi。",
      plannedEpisodes: 6,
      canDos: [
        "能在茶敘時自我介紹並用兩句話說明自己的工作",
        "能在演講後提出一個清楚、有禮貌的問題並追問",
        "能在圓桌討論中表達看法並回應不同意見",
        "能做一場簡短的英文發表並回答現場提問",
        "能在晚餐社交中閒聊並自然地聊到工作上的合作",
        "能約定後續聯絡方式與下一步，並得體道別",
        "能在沒聽懂時請對方重複或換個說法",
      ],
      outline: [
        "報到與開場茶敘：向主持人 Ben 和其他與會者自我介紹",
        "主題演講後提問：針對 Anneke 談的 AI 詐欺偵測提出問題並追問",
        "圓桌討論：談台灣保險業導入 AI 的經驗，回應不同看法",
        "你的短講：十分鐘發表與現場 Q&A",
        "晚宴：與 Dewi 和 Anneke 閒聊，聊到可能的合作",
        "最後一天：交換聯絡方式、約定後續會議、道別",
      ],
      storyState: {
        characters: [
          { name: "Ben Okafor", note: "研討會主持人，熱情健談，很會把人介紹給彼此" },
          { name: "Anneke de Vries", note: "荷蘭銀行的 AI 詐欺偵測講者，講話快、用很多術語" },
          { name: "Dewi Santoso", note: "印尼銀行的數位轉型主管，對台灣的做法很好奇，想找合作對象" },
        ],
        events: [],
        openThreads: [
          "你的短講排在第二天下午，投影片還在改",
          "主管交代至少要帶回一個可以後續聯絡的合作對象",
        ],
      },
      episode1: {
        title: "報到與茶敘：先把自己介紹出去",
        contentContext:
          "研討會第一天早上，你剛報到，手上拿著咖啡站在茶敘區。主持人 Ben 走過來打招呼，並把你介紹給旁邊的人。你要自我介紹、用兩句話說清楚自己在做什麼、對這場研討會有興趣的主題，並主動問對方的工作。聽不懂時要請對方再說一次。",
        coachRole: "主持人 Ben Okafor，接著扮演茶敘區的兩三位與會者：友善、健談，會問你來自哪裡、做什麼",
        userRole: "台灣保險公司的 AI 專案負責人，第一次參加國際研討會",
        objectives: [
          "自我介紹：名字、公司、負責的工作，兩三句說完",
          "說出自己最想在這場研討會了解的主題",
          "主動問對方的工作，並接著追問一個問題",
          "聽不懂時請對方重複或說慢一點",
        ],
        targetPhrases: [
          "Hi, I'm from a life insurance company in Taiwan.",
          "I lead a small team working on AI for customer service.",
          "I'm especially interested in the fraud detection sessions.",
          "What brings you to the conference?",
          "How do you handle that at your company?",
          "Sorry, could you say that again a little more slowly?",
          "It was great meeting you — I hope we can talk more later.",
          "Which session are you heading to next?",
        ],
        recap: "你到了新加坡的金融 AI 研討會，三天內要做一場短講、問幾個好問題、認識幾個人。第一天早上先從茶敘開始，把自己介紹出去。",
        canDoIndexes: [1, 7],
      },
    },
    {
      id: "def-arc-en-remote-ai-build",
      title: "跨國團隊共建 AI 助理：六週遠距協作",
      targetLanguage: "en",
      level: "B1",
      premise:
        "你和新加坡、雪梨的同事組成一個小團隊，六週內要做出一個給業務員用的生成式 AI 助理。所有會議都是視訊。產品負責人 Liam 在雪梨，工程主管 Priya 在新加坡，你代表台灣的使用者。這條線從 kickoff 自我介紹與分工開始，經過需求釐清、站立會議、被指出問題的 demo、排程衝突，最後是成果發表。",
      plannedEpisodes: 6,
      canDos: [
        "能在視訊 kickoff 自我介紹並確認自己的角色與分工",
        "能說明台灣市場的差異需求，並用例子讓對方理解",
        "能在站立會議簡短報告進度與阻礙",
        "能在 demo 被指出問題時接受回饋並提出修正方向",
        "能在排程衝突時提出替代方案並協商",
        "能在成果發表中說明做了什麼、學到什麼、下一步是什麼",
        "能在視訊會議中確認自己聽懂，並在需要時請對方重講",
      ],
      outline: [
        "Kickoff 視訊會議：自我介紹、確認目標與六週分工",
        "需求釐清：說明台灣業務員的使用情境與市場差異",
        "站立會議：報告進度、說出阻礙、請求協助",
        "Demo 回顧：Liam 指出助理答非所問，討論怎麼修",
        "排程衝突：測試時程撞上台灣的假期，提出替代方案協商",
        "成果發表：向兩地主管說明成果、學到的事與下一步",
      ],
      storyState: {
        characters: [
          { name: "Liam Carter", note: "雪梨的產品負責人，直率、節奏快，開會喜歡直接下結論" },
          { name: "Priya Nair", note: "新加坡的工程主管，有耐心、重視細節，會幫你把話補完整" },
        ],
        events: [],
        openThreads: [
          "六週的時程很緊，第三週要交出可以 demo 的版本",
          "台灣的業務員習慣用中文問問題，助理的中文支援還沒定案",
        ],
      },
      episode1: {
        title: "Kickoff 視訊會議：分工說清楚",
        contentContext:
          "第一次三地視訊 kickoff。Liam 主持，先請大家自我介紹，接著說明六週目標，然後問每個人要負責什麼、有什麼疑慮。你要介紹自己、說明台灣這邊能提供什麼（使用者訪談、測試業務員），主動提出中文支援的疑慮，並確認每週開會的時間（時差）。",
        coachRole: "先扮演主持會議的產品負責人 Liam Carter（直接、節奏快），中段由工程主管 Priya Nair 補充問你台灣的細節",
        userRole: "代表台灣使用者的專案成員，第一次和這兩位同事合作",
        objectives: [
          "自我介紹並說明自己在專案中負責的部分",
          "說出台灣這邊可以提供的資源（訪談、測試的業務員）",
          "提出中文支援的疑慮，並請團隊在時程裡考慮",
          "確認每週會議時間，處理時差的問題",
        ],
        targetPhrases: [
          "Hi everyone, I'm the contact for the Taiwan sales team.",
          "I can set up interviews with five agents in the first two weeks.",
          "One concern: our agents will ask questions in Chinese.",
          "Could we add Chinese support to the plan for week three?",
          "What time works for everyone, given the time difference?",
          "Sorry, my connection dropped for a second — could you repeat that?",
          "Just to confirm my part: interviews, testing, and feedback.",
          "That sounds good to me.",
        ],
        recap: "你加入了一個三地團隊，六週內要做出給業務員用的 AI 助理。今天是第一次視訊 kickoff，先把自己是誰、負責什麼說清楚。",
        canDoIndexes: [1, 7],
      },
    },
  ],
  ja: [
    {
      id: "def-arc-ja-tokyo-trip",
      title: "東京自由行：五天連續劇",
      targetLanguage: "ja",
      level: "A2",
      premise:
        "你第一次一個人到東京自由行五天。從成田機場買交通卡、進市區、飯店入住，到吃拉麵、迷路問路、身體不適去藥妝店，最後買伴手禮、把行李寄到機場離開。每一集都是旅途上的下一個場景，會遇到同一位親切的飯店櫃檯 田中さん。",
      plannedEpisodes: 6,
      canDos: [
        "能在車站買票或加值，並問清楚要搭哪一線",
        "能在飯店辦入住、寄放行李並提出簡單需求",
        "能在餐廳點餐、加點並說出自己的偏好或忌口",
        "能在迷路時向路人問路並確認自己聽懂了",
        "能在藥妝店描述身體不舒服的症狀並請人推薦",
        "能在店裡詢問價格、尺寸或退稅並完成結帳",
        "能為受到的幫助道謝，並自然地結束對話",
      ],
      outline: [
        "成田機場：買 Suica／問去市區要搭哪一線",
        "飯店入住：辦 check-in、行李寄放、問附近吃什麼",
        "拉麵店：點餐、加點、說出自己的口味偏好",
        "迷路：在街上向路人問路，確認方向與距離",
        "藥妝店：說明身體不舒服的症狀、請店員推薦並結帳",
        "最後一天：買伴手禮與退稅，請飯店幫忙把行李寄到機場並道別",
      ],
      storyState: {
        characters: [
          { name: "田中さん", note: "飯店櫃檯人員，講話慢而清楚，會耐心等你把日文講完" },
        ],
        events: [],
        openThreads: [
          "你還沒有交通卡，也還不確定從成田要搭哪一線進市區",
          "五天的行程只排了大概，想吃的東西還沒吃到",
        ],
      },
      episode1: {
        title: "成田機場：買 Suica，問怎麼進市區",
        contentContext:
          "你剛抵達成田機場第二航廈，走出入境大廳。你要先在售票處或便利商店買一張 Suica 並加值，然後問清楚要怎麼到新宿的飯店——有 Skyliner、成田特快 N'EX 和便宜的巴士，你得問哪個比較快、多少錢、在哪裡搭。教練扮演售票處人員與服務中心的站務員。",
        coachRole: "成田機場售票處的服務人員，接著是旅遊服務中心的站務員；講話慢、清楚，會示範說法讓你跟著說",
        userRole: "第一次一個人來東京自由行的台灣旅客",
        objectives: [
          "說出要買 Suica 並說明要加值多少錢",
          "問到新宿要搭哪一線，以及大概要多久",
          "問清楚票價，並確認在哪個月台或幾號乘車處搭車",
          "聽不懂時請對方再說一次或說慢一點",
        ],
        targetPhrases: [
          "スイカを買いたいです。（Suica o kaitai desu.）",
          "三千円チャージしてください。（Sanzen-en chāji shite kudasai.）",
          "新宿までどう行きますか。（Shinjuku made dō ikimasu ka.）",
          "どのくらいかかりますか。（Dono kurai kakarimasu ka.）",
          "いくらですか。（Ikura desu ka.）",
          "何番のりばですか。（Nan-ban noriba desu ka.）",
          "もう一度お願いします。（Mō ichido onegai shimasu.）",
          "ゆっくり話してください。（Yukkuri hanashite kudasai.）",
        ],
        recap: "你剛降落成田機場，五天的東京自由行從這裡開始。第一件事：弄到一張交通卡，然後想辦法進市區。",
        canDoIndexes: [1],
      },
    },
    {
      id: "def-arc-ja-kansai-trip",
      title: "關西自由行：京都・奈良・大阪六天",
      targetLanguage: "ja",
      level: "A2",
      premise:
        "你第二次到日本，這次從關西機場進，六天走京都、奈良、大阪。住的是京都的町家旅館，女將 佐藤さん 會在每一集出現：幫你安排晚餐、教你怎麼搭車、聽你講今天遇到的事。從機場搭電車到京都、旅館入住、神社參拜、奈良餵鹿、大阪居酒屋，到最後買電器退稅、把行李寄回機場。",
      plannedEpisodes: 6,
      canDos: [
        "能在機場與車站問清楚要搭哪一班電車、在哪裡換車",
        "能在旅館辦入住、確認晚餐時間並提出簡單需求",
        "能在神社或寺院問參拜方式並買御守",
        "能向路人或站務員問公車與班次，並確認聽懂",
        "能在居酒屋點飲料與下酒菜，並請店員推薦",
        "能在商店詢問退稅條件並完成結帳",
        "能說明今天發生的事，並為受到的幫助道謝",
      ],
      outline: [
        "關西機場：問去京都要搭哪一班、在哪裡換車，買票上車",
        "町家旅館：辦入住、確認晚餐與洗澡時間，問附近好走的路",
        "伏見稻荷：問參拜方式、買御守、和攤販買點心",
        "奈良：問公車班次、到公園餵鹿，向路人問去東大寺的路",
        "大阪居酒屋：點飲料與下酒菜、請店員推薦、和鄰座簡單聊天",
        "最後一天：買電器辦退稅，請旅館幫忙寄行李到機場，向佐藤さん道別",
      ],
      storyState: {
        characters: [
          { name: "佐藤さん", note: "京都町家旅館的女將，說話溫和、會主動放慢，喜歡問你今天去了哪裡" },
        ],
        events: [],
        openThreads: [
          "從關西機場到京都有好幾種搭法，你還不知道要在哪裡換車",
          "旅館的晚餐要事先約時間，你還沒決定幾點吃",
        ],
      },
      episode1: {
        title: "關西機場：搭電車到京都",
        contentContext:
          "你剛出關西機場的入境大廳，要搭電車到京都。站務員會告訴你可以搭 JR はるか 直達，或搭南海電車再換車比較便宜。你要問清楚哪一班比較快、多少錢、要不要換車、在哪個月台，買票後在月台再向站務員確認一次。教練扮演售票處與月台的站務員。",
        coachRole: "關西機場站的站務員：親切、講話清楚，會用手勢和簡單的字幫你確認",
        userRole: "第二次到日本、第一次走關西的台灣旅客",
        objectives: [
          "說出要去京都，並問哪一班電車比較快",
          "問清楚票價、要不要換車、在哪裡換",
          "確認月台號碼與發車時間",
          "聽不懂時請對方再說一次",
        ],
        targetPhrases: [
          "京都まで行きたいです。（Kyōto made ikitai desu.）",
          "どれが一番速いですか。（Dore ga ichiban hayai desu ka.）",
          "乗り換えは必要ですか。（Norikae wa hitsuyō desu ka.）",
          "どこで乗り換えますか。（Doko de norikaemasu ka.）",
          "いくらですか。（Ikura desu ka.）",
          "何番線ですか。（Nan-ban-sen desu ka.）",
          "次の電車は何時ですか。（Tsugi no densha wa nan-ji desu ka.）",
          "すみません、もう一度お願いします。（Sumimasen, mō ichido onegai shimasu.）",
        ],
        recap: "這次你從關西機場進日本，六天要走京都、奈良、大阪。第一件事：搞清楚怎麼搭電車到京都的旅館。",
        canDoIndexes: [1],
      },
    },
  ],
};
