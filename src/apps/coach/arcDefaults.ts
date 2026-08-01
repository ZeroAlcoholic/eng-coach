// S4 — built-in demo story arcs, so the narrative pull is available without
// authoring anything. Two arcs, one per language (ROADMAP: EN 出差線、JA 東京
// 自由行, each ≤6 episodes).
//
// Only EPISODE 1 is authored. Episodes 2–6 are generated on the normal
// end-of-episode path, kept on the designed shape by `outline` and drawing on the
// same `storyState` seed — so the story still reacts to what the learner actually
// said, instead of replaying a script. Stable ids (like DEFAULT_SCENARIOS) mean
// installing twice leaves one arc, and an installed arc drops out of the list.

import type { DemoArc } from "./arcs";
import type { TargetLanguage } from "../../kernel/types";

export const DEFAULT_ARCS: Record<TargetLanguage, DemoArc[]> = {
  en: [
    {
      id: "def-arc-en-london-trip",
      title: "倫敦出差：從入境到應酬",
      targetLanguage: "en",
      level: "B1",
      premise:
        "你被派到倫敦出差一週，向新客戶 Whitfield Retail 交付一個延宕的系統升級案。當地同事 Priya 接應你，客戶端的決策者是要求嚴格的採購總監 Daniel Whitfield。這趟從入境、對接、正式會議，一路走到交付出狀況、協商補救，最後在商務晚宴上收尾。",
      plannedEpisodes: 6,
      canDos: [
        "能在入境與交通場景說明來意，並處理突發狀況",
        "能與當地同事對齊會議目標並確認彼此分工",
        "能在會議中清楚說明自己負責的部分並回答追問",
        "能在被質疑時坦白說明原因，同時維持專業",
        "能提出具體的補救方案並說明新時程",
        "能禮貌但堅定地協商範圍或期限，爭取折衷",
        "能在商務社交場合自然閒聊並得體收尾",
      ],
      outline: [
        "希斯洛機場：入境問答、行李出狀況，找到公司安排的接送",
        "抵達倫敦辦公室：與當地同事 Priya 對接，確認明天客戶會議的目標與分工",
        "客戶會議：向 Daniel 說明升級案現況並回答追問",
        "危機：測試環境出問題導致交付再延，必須向客戶說明並致歉",
        "協商：提出縮小範圍先上線的折衷方案，談定新時程",
        "商務晚宴：與客戶輕鬆閒聊、修復關係，並敲定後續",
      ],
      storyState: {
        characters: [
          { name: "Priya Raman", note: "倫敦辦公室的專案經理，務實、消息很快，是你在當地的接應人" },
          { name: "Daniel Whitfield", note: "客戶端採購總監，重視守時與具體承諾，被延誤過一次所以耐心有限" },
        ],
        events: [],
        openThreads: [
          "系統升級案已經延誤過一次，客戶對第二次延誤幾乎不會容忍",
          "你還沒見過 Daniel 本人，第一印象很關鍵",
        ],
      },
      episode1: {
        title: "希斯洛入境：行李沒跟上",
        contentContext:
          "你剛下飛機，在希斯洛機場入境檢查櫃檯。移民官會問你來訪目的、待多久、住哪裡。過關後你發現托運行李沒有出現在行李轉盤上，裡面有你要給客戶看的資料；你得去行李櫃檯申報，並問清楚什麼時候能送到飯店。最後要在到達大廳找到公司安排的接送司機。",
        coachRole:
          "先扮演希斯洛的移民官（公事公辦但不刁難），接著扮演航空公司行李櫃檯人員，最後扮演接送司機",
        userRole: "第一次到倫敦出差的台灣專案負責人",
        objectives: [
          "清楚回答入境目的、停留天數與住宿地點",
          "向行李櫃檯說明行李沒出現，並描述行李外觀",
          "問清楚行李何時送達、送到哪裡，並留下聯絡方式",
          "在到達大廳與司機確認身分並說出目的地",
        ],
        targetPhrases: [
          "I'm here on business for a week.",
          "I'm staying at a hotel near King's Cross.",
          "My checked bag didn't come out on the belt.",
          "It's a black hard-shell suitcase with a red tag.",
          "Could you deliver it to my hotel once it arrives?",
          "Here's my mobile number and the hotel address.",
          "Are you the driver for Whitfield Retail?",
          "Could we head to the hotel first?",
        ],
        recap: "你落地倫敦，這一週要向已經被延誤過一次的客戶交出成果。第一關先過入境，然後找到接送。",
        canDoIndexes: [1],
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
  ],
};
