// Synthetic practice transcripts for screening the judge and for the
// annotation rules. Written by hand for this purpose — no real learner, no
// names, no key. The first six span both target languages, three CEFR bands, a
// barely-there learner, and a coach-only session, so a model that inflates,
// hallucinates examples or fails the validator shows it. The last four each
// contain exactly one thing annotate.ts must catch: parroting, a spoken help
// request, Chinese inside an English sentence, Chinese inside Japanese.

import type { CEFRLevel, TargetLanguage, TranscriptTurn } from "../../../../kernel/types";

export interface JudgeFixture {
  id: string;
  language: TargetLanguage;
  level: CEFRLevel;
  objectives: string[];
  transcript: TranscriptTurn[];
  // What a careful human reader would say — the screening compares AGAINST these
  // loosely (band ±1), never treats them as ground truth for a score.
  expectBand: CEFRLevel | null; // null = should be unavailable
  expectErrorTypes: string[]; // patterns a reader can actually point at
  // Learner-turn indices (counting learner turns only, from 0) a reader would
  // flag; absent on the six screening fixtures, which contain none.
  expectFlags?: { echo?: number[]; aided?: number[]; l1?: number[] };
  // For the code-mixing fixtures: which objective was completed only with a
  // Chinese word, and the Chinese the learner said (H2 checks the judge's
  // compliance with the not-met rule and the fallback substring rule).
  expectMixed?: { objectiveNotMet: string; said: string[] };
}

export const FIXTURES: JudgeFixture[] = [
  {
    id: "en-a2-hotel",
    language: "en",
    level: "A2",
    objectives: ["ask for a late checkout", "report a problem with the room"],
    expectBand: "A2",
    expectErrorTypes: ["tense", "article"],
    transcript: [
      { who: "coach", text: "Good morning! Front desk, how can I help you today?" },
      { who: "user", text: "Hello. I want ask late checkout. Is it possible?" },
      { who: "coach", text: "Late checkout — sure. Until what time would you like?" },
      { who: "user", text: "Maybe two o'clock. Also yesterday the shower is not working, water is cold." },
      { who: "coach", text: "I'm sorry to hear that. Was it cold the whole time?" },
      { who: "user", text: "Yes, I try many time, I wait ten minute but still cold." },
      { who: "coach", text: "I'll send someone up right away. Anything else?" },
      { who: "user", text: "No, thank you. Two o'clock is okay for checkout?" },
      { who: "coach", text: "Two o'clock is fine. Enjoy your morning!" },
    ],
  },
  {
    id: "en-b1-budget",
    language: "en",
    level: "B1",
    objectives: ["defend a 10% increase", "propose a compromise"],
    expectBand: "B1",
    expectErrorTypes: ["agreement"],
    transcript: [
      { who: "coach", text: "So, walk me through why marketing needs ten percent more next quarter." },
      { who: "user", text: "Sure. Last quarter the campaign bring in thirty percent more leads, but our cost per lead go up because the platform raised prices." },
      { who: "coach", text: "Prices went up for everyone. Why should your team absorb it with extra budget?" },
      { who: "user", text: "Because if we cut spend, the pipeline dries up in two months. The sales team depends on these leads." },
      { who: "coach", text: "What if I gave you five percent instead of ten?" },
      { who: "user", text: "Then I would propose a compromise: five percent now, and we review the numbers in six weeks. If the cost per lead is still rising, we discuss the rest." },
      { who: "coach", text: "That's reasonable. Put it in writing and we'll take it to finance." },
      { who: "user", text: "Great, I will send the summary by Friday." },
    ],
  },
  {
    id: "en-b2-negotiation",
    language: "en",
    level: "B2",
    objectives: ["push back on a deadline", "agree next steps"],
    expectBand: "B2",
    expectErrorTypes: [],
    transcript: [
      { who: "coach", text: "We need the integration live by the fifteenth. Can your team commit?" },
      { who: "user", text: "Honestly, the fifteenth is tight. We can hit it if we drop the reporting module from the first release and ship it two weeks later." },
      { who: "coach", text: "Reporting is what the client asked for first." },
      { who: "user", text: "I understand, but rushing it means shipping numbers we haven't validated, and that's the part they'll notice. I'd rather give them a reliable core on the fifteenth and a reporting beta on the first." },
      { who: "coach", text: "And if they push back?" },
      { who: "user", text: "Then let's offer a weekly demo so they see progress. Shall I draft the revised plan today and we align tomorrow morning?" },
      { who: "coach", text: "Do that. Copy me on the draft." },
    ],
  },
  {
    id: "ja-a1-ramen",
    language: "ja",
    level: "A1",
    objectives: ["注文する", "辛さを調整してもらう"],
    expectBand: "A1",
    expectErrorTypes: ["particle"],
    transcript: [
      { who: "coach", text: "いらっしゃいませ！ご注文はお決まりですか？" },
      { who: "user", text: "えっと… しょうゆラーメン、ひとつ、ください。" },
      { who: "coach", text: "しょうゆラーメンおひとつですね。辛さはどうしますか？" },
      { who: "user", text: "からい… すこし、おねがいします。からいを すこし。" },
      { who: "coach", text: "少し辛め、了解です。お飲み物は？" },
      { who: "user", text: "みず、ください。" },
      { who: "coach", text: "お水ですね。少々お待ちください。" },
    ],
  },
  {
    id: "en-a1-minimal",
    language: "en",
    level: "A1",
    objectives: ["introduce yourself"],
    expectBand: "A1",
    expectErrorTypes: [],
    transcript: [
      { who: "coach", text: "Hi! Welcome. What's your name?" },
      { who: "user", text: "My name is… uh… I am from Taiwan." },
      { who: "coach", text: "Nice to meet you! What do you do?" },
      { who: "user", text: "Engineer. Software." },
      { who: "coach", text: "Great. Do you like it?" },
      { who: "user", text: "Yes." },
    ],
  },
  {
    id: "coach-only",
    language: "en",
    level: "B1",
    objectives: ["say anything"],
    expectBand: null,
    expectErrorTypes: [],
    transcript: [
      { who: "coach", text: "Hello? Are you there? Let's start whenever you're ready." },
      { who: "coach", text: "I'll set the scene: you're at the airport check-in desk…" },
      { who: "coach", text: "Take your time." },
    ],
  },
];

/** The four annotation fixtures. Kept apart from the screening six so the
 *  screening table's baseline rows keep meaning what they meant. */
export const ANNOTATION_FIXTURES: JudgeFixture[] = [
  {
    id: "en-echo",
    language: "en",
    level: "A2",
    objectives: ["ask for directions"],
    expectBand: null, // every learner line is the coach's line said back
    expectErrorTypes: [],
    expectFlags: { echo: [0, 1, 2] },
    transcript: [
      { who: "coach", text: "Try this: Excuse me, how do I get to the station?" },
      { who: "user", text: "Excuse me, how do I get to the station?" },
      { who: "coach", text: "Go straight and turn left at the bank." },
      { who: "user", text: "Go straight and turn left at the bank." },
      { who: "coach", text: "Now say: Is it far from here?" },
      { who: "user", text: "Is it far from here?" },
    ],
  },
  {
    id: "en-spoken-help",
    language: "en",
    level: "B1",
    objectives: ["ask for a refund"],
    expectBand: "B1",
    expectErrorTypes: [],
    expectFlags: { aided: [1, 2], l1: [1] },
    transcript: [
      { who: "coach", text: "Hi, this is customer service. How can I help?" },
      { who: "user", text: "Hello, I bought a jacket last week but the zipper is broken." },
      { who: "coach", text: "I'm sorry to hear that. What would you like us to do?" },
      { who: "user", text: "退款怎麼說?" },
      { who: "coach", text: "退款 is a refund. Try: I'd like a refund, please." },
      { who: "user", text: "I would like a full refund, please, and I can send the jacket back." },
      { who: "coach", text: "Of course. We'll email you a return label." },
      { who: "user", text: "Thank you, that works for me." },
    ],
  },
  {
    id: "en-mixed",
    language: "en",
    level: "A2",
    objectives: ["book a table", "ask about opening hours"],
    expectBand: "A2",
    expectErrorTypes: [],
    expectFlags: { l1: [0, 2] },
    expectMixed: { objectiveNotMet: "book a table", said: ["預約", "幾點"] },
    transcript: [
      { who: "coach", text: "Good evening, Luigi's restaurant. How can I help you?" },
      { who: "user", text: "Hello, I want to 預約 a table for two on Friday." },
      { who: "coach", text: "預約 is book — I'd like to book a table. Friday at what time?" },
      { who: "user", text: "Seven o'clock, please." },
      { who: "coach", text: "Seven o'clock, table for two. Anything else?" },
      { who: "user", text: "You open until 幾點 on Friday?" },
      { who: "coach", text: "We're open until eleven. See you Friday!" },
    ],
  },
  {
    id: "ja-mixed",
    language: "ja",
    level: "A1",
    objectives: ["予約する", "時間を聞く"],
    expectBand: "A1",
    expectErrorTypes: [],
    expectFlags: {}, // kanji is Japanese too: text alone cannot flag these
    expectMixed: { objectiveNotMet: "予約する", said: ["我想要", "幾點"] },
    transcript: [
      { who: "coach", text: "はい、レストラン花です。ご用件は？" },
      { who: "user", text: "すみません、我想要 予約 ふたり、きんようび。" },
      { who: "coach", text: "予約ですね。「予約をお願いします」と言ってみましょう。何時ですか？" },
      { who: "user", text: "しちじ、おねがいします。" },
      { who: "coach", text: "七時、二名様ですね。他に何かありますか？" },
      { who: "user", text: "きんようび、幾點 まで？" },
      { who: "coach", text: "十一時までです。お待ちしております。" },
    ],
  },
];
