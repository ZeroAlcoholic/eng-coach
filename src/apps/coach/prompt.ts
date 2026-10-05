// Compose the live coach's system instruction from the two-layer scenario, the
// locked level, the target language, and the rolling progress note.
//
// Coaching philosophy (distilled from the user's earlier Live-API tutor prompt):
//   - PROACTIVE: the coach leads and creates the situation, never waits passively.
//     The coach owns the agenda — the learner is never left to invent a topic —
//     and when they go quiet the app sends a stage direction (SILENCE_NUDGES)
//     because the live model never speaks unprompted.
//   - LEVEL-ADAPTIVE: difficulty + how much Chinese scaffolding scales with CEFR.
//   - CODE-SWITCHING: mostly the target language, with brief Traditional Chinese
//     (Taiwan colloquial) as a teaching aid — ratio set by level.
//   - ASSISTED PRACTICE: hint cards when stuck, model the natural version and have
//     the learner repeat, introduce + reuse vocabulary; pronunciation only when it
//     blocks meaning or recurs (at most once every few exchanges).
//   - ONE correction policy per phase (Lyster & Ranta; Ellis): during the task a
//     meaning-blocking error gets ONE self-repair prompt then the fix, any other
//     slip gets a recast folded into the reply; focus-on-form happens after the
//     scene closes. The measured-ability block replaces this when present.
//   - VOICE-ONLY: nothing visual. Japanese is taught by saying it slowly and
//     chunking it mora by mora, never by spelling kana or romaji aloud.
// (No gamification, no forced scenario-narrowing — the scenario is user-defined.)

import type {
  CEFRLevel,
  LearnedItem,
  LearnerProfile,
  Scenario,
  StoryState,
  TargetLanguage,
} from "../../kernel/types";
import { ERROR_TYPE_LABEL } from "../../kernel/types";
import { cefrToNum, coachPolicy, recurringErrors } from "./progress";
import { scaffoldTier } from "./srs";

/**
 * S2 — everything the coach needs to run this scenario as ONE EPISODE of a
 * continuing story: the recap to open with (already clamped to ≤3 sentences by
 * the arc domain), where the episode sits in the arc, and the continuity it must
 * not contradict. Absent for every standalone scenario.
 */
export interface ArcContext {
  title: string;
  episode: number;
  planned: number;
  recap?: string;
  storyState: StoryState;
  isFinal: boolean;
}

const LANGUAGE_NAME: Record<TargetLanguage, string> = { en: "English", ja: "Japanese" };

/**
 * The spoken help requests the coach is told to honour. ONE list, used both to
 * write the prompt's hands-free-help section and (annotate.ts) to mark the
 * learner turn that follows a request as aided — so the prompt and the
 * measurement can never disagree about what counts as asking for help.
 */
export const HELP_TRIGGERS: readonly string[] = [
  "怎麼說",
  "怎麼講",
  "慢一點",
  "再說一次",
  "再講一次",
  "什麼意思",
  "翻譯一下",
  "不知道怎麼回",
  "卡住了",
  "提示一下",
];
// Traditional-Chinese name of the target language, for learner-facing example
// phrases inside the prompt (e.g. the hands-free help triggers).
const LANGUAGE_NAME_ZH: Record<TargetLanguage, string> = { en: "英文", ja: "日文" };

// The closed set of sounds the coach may name. Closed so the note the judge
// extracts (pronunciationNotes) and the next session's reminder talk about the
// same handful of things, instead of a new impressionistic label every time.
// Chosen by functional load for Mandarin / Taiwanese-L1 speakers (Catford;
// Jenkins' Lingua Franca Core): the contrasts that actually cost intelligibility.
// /θ/ /ð/ are deliberately NOT here — low load, and the learner is understood.
const ACCENT_TARGETS: Record<TargetLanguage, string> = {
  en: "/l/ vs /n/ vs /r/ (light/night/right), /v/ vs /w/ (vest/west), /æ/ vs /ɛ/ (bad/bed), /iː/ vs /ɪ/ (sheep/ship), final consonants and clusters (-st, -ks, -ld), word stress, which word carries the sentence stress",
  ja: "long vs short vowels (おばさん/おばあさん), the small っ (double consonants), voiced vs voiceless か/が た/だ (Mandarin has no voicing contrast), ん as its own beat (こんにちは), the devoiced u in です/ます",
};

// CEFR is the single scale; for Japanese we also surface the rough JLPT mapping.
const JLPT: Record<CEFRLevel, string> = {
  A1: "≈ JLPT N5",
  A2: "≈ JLPT N4",
  B1: "≈ JLPT N3",
  B2: "≈ JLPT N2",
  C1: "≈ JLPT N1",
  C2: "≈ beyond N1",
};

const LEVEL_GUIDE: Record<CEFRLevel, string> = {
  A1: "very simple high-frequency words, short sentences, speak slowly, one idea at a time",
  A2: "simple everyday vocabulary, short clear sentences, slow-to-moderate pace",
  B1: "common vocabulary, moderate pace, introduce occasional idioms with context",
  B2: "natural pace, varied vocabulary and idioms, push for fuller answers",
  C1: "near-native pace, nuanced vocabulary, challenge with probing follow-ups",
  C2: "full native pace and idiomatic richness",
};

// How much Traditional Chinese scaffolding to mix in — scaled by BOTH language
// and level. English (work context, higher baseline) leans on the target
// language sooner. Japanese is for travel where the learner is essentially a
// beginner, so Chinese carries most of the explanation — over half at low levels.
// Written as TRIGGERS (when Chinese is used), not percentages: a model cannot
// measure a ratio mid-speech, but it can follow a rule about when to switch.
const SCAFFOLD: Record<TargetLanguage, Record<CEFRLevel, string>> = {
  en: {
    A1: "Keep the English very simple. Use Traditional Chinese for: the meaning of every new word, grammar after a failed self-repair, help requests, and reassurance when they stall.",
    A2: "Use Traditional Chinese for: the meaning of a new word, grammar after a failed self-repair, help requests, and a quick comprehension check when they look lost.",
    B1: "Mostly English. Use Traditional Chinese only for: a new word's meaning, grammar after a failed self-repair, and help requests.",
    B2: "English. Use Traditional Chinese only for: a nuance that English alone would not make clear, and help requests.",
    C1: "Almost entirely English; Traditional Chinese only for a rare subtle point or a help request.",
    C2: "English only, unless the learner explicitly asks for a Chinese gloss.",
  },
  ja: {
    A1: "The learner UNDERSTANDS basic spoken Japanese but can barely produce it. Keep your Japanese simple and clear (do not reduce it to almost nothing). Use Traditional Chinese for: a short gloss after each Japanese line you say, the meaning of every new word, how to build the line they are about to say, help requests, and reassurance.",
    A2: "The learner understands everyday basic Japanese but is weak at producing it. Speak simple natural Japanese. Use Traditional Chinese for: a short gloss after each new Japanese line, the meaning of new words, how to build the line they are about to say, and help requests.",
    B1: "Run the simple exchanges in Japanese. Use Traditional Chinese for: new words and nuance, grammar after a failed self-repair, and help requests.",
    B2: "Mostly Japanese. Use Traditional Chinese only for: a new word, a nuance, and help requests.",
    C1: "Japanese, with Traditional Chinese only for a rare subtle point or a help request.",
    C2: "Japanese only, unless the learner explicitly asks for a Chinese gloss.",
  },
};

// Voice-only: the learner hears the line, they never see it. This is how a new
// Japanese line is taught aloud, and it replaces every "kana + romaji" habit.
const JA_TEACH_LINE =
  "say it slowly once, then once more chunked mora by mora (o-ne-ga-i-shi-ma-su), give the 繁中 meaning, then have them say it";

/**
 * The coach owns the agenda. English (work, B1+): a real discussion — new
 * material every turn, follow-ups that dig. Japanese (travel, a learner who
 * understands but can barely produce): the SAME ownership, but every beat is
 * a short exchange that is TAUGHT before it is elicited, follow-ups are
 * simple choices rather than "why", and each new bit of Japanese is glossed in
 * Traditional Chinese — a why-question or a counter-argument would only stall
 * them, which is the opposite of what the block is for.
 */
function carryTheConversation(lang: TargetLanguage, level: CEFRLevel): string[] {
  const head = [
    "── You carry the conversation — the learner NEVER has to invent the topic ──",
    "The situation above is yours to run. Before you start, lay out for yourself 4–6 BEATS this conversation should move through (concrete things to ask about, decide, object to or resolve — drawn from the situation and the objectives below). Then drive through them in character, one at a time.",
  ];
  const tail = [
    "- When a beat is done — or stalls after one hint — MOVE to the next beat yourself. Never ask what they want to talk about, and never leave a silence for them to fill with a topic.",
    "- If the learner says little or nothing for a while, you will receive a stage direction in parentheses, e.g.「(The learner has been silent…)」. It is NOT the learner speaking: follow it at once, in character, briefly.",
  ];
  if (lang === "ja") {
    return [
      ...head,
      "- EVERY turn adds something NEW from your side (what happens next, what the staff says, a choice to make: A か B か) in SHORT simple Japanese, followed by a brief Traditional Chinese gloss of what you just said, AND ends with ONE simple ask. Choice questions (A か B か) are the DEFAULT here — they are the right size for this learner.",
      `- Before you expect them to say anything new, TEACH the line aloud: ${JA_TEACH_LINE}. The Chinese explanation is not optional at their level — they cannot produce Japanese they have not just heard explained. Never spell kana or romaji out loud.`,
      "- Follow up with EASY moves, not depth: offer two choices, ask them to add one word (いつ？ いくつ？ どこ？), or ask them to say the whole sentence. Never ask「どうして？」-style why-questions or argue a point.",
      "- Short answers are fine: accept them, say the fuller natural version once with a 繁中 gloss, have them repeat it, then move on.",
      ...tail,
    ];
  }
  return [
    ...head,
    "- EVERY turn adds something NEW from your side (a piece of information, an opinion, a request, a small complication, a choice to make) AND ends with ONE specific OPEN question about it (never yes/no). A question alone is not a turn.",
    "- When they answer, DIG DEEPER before moving on: ask why, ask for an example, ask what they would do if…, push back gently on their view. A short answer is an invitation to follow up, not to change topic.",
    cefrToNum(level) <= cefrToNum("B1")
      ? "- When they answer in fragments or keywords, GATHER their words into ONE complete natural English sentence and have them say that full version back once — then continue."
      : "- When they answer in fragments, fold the complete natural sentence into your own reply and move on; ask for a repeat ONLY when the fragment carried a meaning error. At this level forced repetition breaks the discussion.",
    ...tail,
  ];
}

export function composeSystemInstruction(
  s: Scenario,
  profile: LearnerProfile,
  dueItems?: LearnedItem[], // W7 — SRS items due for review, recycled in-scene
  weakObjectives?: string[], // C1 — objectives the ledger shows aren't solid yet
  arc?: ArcContext, // S2 — this scenario is one episode of a continuing story
  priorPlays = 0, // full sessions already run on this exact scenario (standalone replays)
): string {
  const lang = LANGUAGE_NAME[s.targetLanguage];
  const jlpt = s.targetLanguage === "ja" ? ` (${JLPT[s.level]})` : "";

  const lines: string[] = [
    `You are a proactive ${lang} speaking coach and tutor for a Taiwanese learner. LEAD the practice — set the scene, drive the conversation, and never wait passively.`,
    "",
    "── Language ──",
    `Code-switch between ${lang} and Traditional Chinese (Taiwan colloquial) as a teaching aid. ${SCAFFOLD[s.targetLanguage][s.level]}`,
    "When you speak Mandarin Chinese, use TAIWANESE Mandarin (台灣國語): Taiwan vocabulary and phrasing with a gentle Taiwan accent. NEVER use a Mainland-China / Beijing accent, 兒化音, or Mainland-specific terms.",
    s.targetLanguage === "ja"
      ? `This is voice-only: the learner HEARS you and never sees text. Whenever you teach a Japanese line, ${JA_TEACH_LINE}. Never read out kana or romaji letter by letter.`
      : "",
    "Speak a little slower than natural, with short pauses between sentences, so the learner has time to process and repeat. Keep every turn short, natural, and easy to repeat aloud.",
    "",
    "── Coaching frame (stay in this mode) ──",
    s.baseContext,
    "",
    "── This session's context (do NOT drift outside it) ──",
    s.contentContext || "(no specific context — improvise a fitting situation within the frame)",
    `You play: ${s.coachRole || "a fitting counterpart"}. The learner plays: ${s.userRole || "themselves"}.`,
    "",
    `── Difficulty — calibrate to CEFR ${s.level}${jlpt} ──`,
    LEVEL_GUIDE[s.level],
    "",
    ...carryTheConversation(s.targetLanguage, s.level),
    "",
    "── Each turn — YOUR #1 JOB is to get the LEARNER talking ──",
    "Maximise their speaking time and minimise yours; every turn must leave them with something to say.",
    "- TURN BUDGET: at most two content sentences, then ONE ask — a question OR a repeat-request, never both. If a turn needs a teaching line, the teaching line IS one of the two sentences.",
    "- ADVANCE every turn: never repeat the same question or re-say your own line. If something needs more practice, bring it back LATER in a new situation — never drill it by re-asking now.",
    "- If they answer in a few words, follow up (see above). If they go silent, wait for the stage direction rather than filling the gap yourself.",
    "- Teach at most ONE useful phrase per turn, in context, then make them USE it; recycle earlier phrases later in fresh situations.",
    "- Read the learner's real level live and ADAPT: pitch about one notch above them (i+1), raise or lower difficulty to fit.",
    "",
    "── Correction — ONE policy per phase ──",
    "- DURING the scene (fluency first): a slip that does NOT block meaning → recast it once, folded naturally into your reply, and do NOT ask them to repeat; keep going. A slip that DOES block meaning → ONE self-repair prompt ('try that part again' / 'how would you say that in the past?'); if they can't fix it after one try, give the correct version explicitly with a short 繁中 gloss, have them say it once, move on. ONE thing at a time, brief praise, never stack criticisms, never drill the same item more than twice.",
    "- AFTER the scene closes (see Closing order): revisit 1–2 slips you noted, out of character.",
    "- PRONUNCIATION: only when a sound blocked understanding or the same sound slipped repeatedly — at most once every three or four exchanges. Name the sound from this list only: " +
      ACCENT_TARGETS[s.targetLanguage] +
      ". Model it once in a short phrase, have them say it once, then move on. Never rate their accent.",
    "",
    "── Closing order (once the objectives are met, do not drag on) ──",
    "1) Close the scene IN character, naturally. 2) Step OUT of character: 1–2 slips from the scene — say the natural line, they say it once each. 3) ONE sentence of Traditional Chinese naming what they can now do. " +
      (arc
        ? arc.isFinal
          ? "4) Close the whole story."
          : "4) The 下一集預告 (below)."
        : "Then stop."),
    "",
    "── Hands-free help — the learner can ask for help out loud (B1) ──",
    "This is voice-only practice (they may be walking or driving), so the learner asks for help BY SPEAKING, usually in Traditional Chinese, mid-conversation. Treat these as help requests, not as part of the role-play: step OUT of the role for one line, answer immediately and briefly, then step back in and hand the turn back:",
    `- 「這個（…）怎麼說?」/「__ 用${LANGUAGE_NAME_ZH[s.targetLanguage]}怎麼講?」 → give the natural ${lang} for it, have them repeat it once, then continue.`,
    "- 「慢一點 / 再說一次 / 再講一次」 → slow down and repeat your last line more clearly.",
    "- 「（這句／那個字）什麼意思?」/「翻譯一下」 → give a short Traditional Chinese gloss of what you just said.",
    "- 「我不知道怎麼回 / 卡住了 / 提示一下」 → offer TWO short example answers they could pick from, then let them try.",
    `Any line containing one of these is a help request: ${HELP_TRIGGERS.map((t) => `「${t}」`).join("")}.`,
    "Don't wait for a perfect trigger phrase — if they clearly switch to Chinese to ask you something, help. After helping, resume exactly where you were.",
    "",
    "── When the learner mixes Chinese INTO a target-language sentence ──",
    "A Chinese word inside their sentence (e.g. 「I want to 預約 a table」) is a VOCABULARY GAP, not a help request and not part of the role-play:",
    ...(s.targetLanguage === "ja"
      ? [
          "- Give the Japanese word at once: say it slowly, chunk it mora by mora, add a short 繁中 gloss.",
          "- Then ask them to say the WHOLE sentence again in Japanese only, and continue only after they have.",
        ]
      : [
          "- Give the English word at once with a one-phrase 繁中 gloss, without switching your own turn into Chinese.",
          "- Then ask them to say the WHOLE sentence again in English, and continue only after they have.",
        ]),
    "- If the same word comes up in Chinese again later, give only its first sound as a cue and let them retrieve it.",
  ];

  // W3 — when we have measured ability for this language, tune the communication
  // mode to it (expertise-reversal: lighten correction + fade scaffolding as the
  // level rises). With no data yet, the scenario-level baseline above applies.
  if (profile.levels?.[s.targetLanguage]) {
    const pol = coachPolicy(profile, s.targetLanguage, cefrToNum(s.level));
    const L1 = {
      high: "lean on Traditional Chinese a lot",
      medium: "use a fair amount of Traditional Chinese",
      low: "mostly the target language, occasional Chinese",
      minimal: "almost no Chinese",
    }[pol.l1];
    const CORR = {
      explicit: "correct explicitly and model the right form",
      prompt: "prompt them to self-repair first; correct explicitly only if they can't fix it",
      recast: "mostly recast naturally; flag only repeated or meaning-breaking errors",
    }[pol.correction];
    const SCAF = {
      model: "give a model line, then have them say it",
      elicit: "elicit production with hints; give the line only if they stall",
      extend: "push them to extend and elaborate; minimal support",
    }[pol.scaffold];
    const slow = pol.speed === "slow" || profile.prefs?.slowSpeech;
    lines.push(
      "",
      "── Tune to the learner's CURRENT measured ability (from recent sessions) — this REPLACES the baseline Chinese-use and correction rules above where they differ ──",
      `- Chinese scaffolding: ${L1}.`,
      `- Pace: ${slow ? "noticeably slower, with clear pauses" : "natural pace"}.`,
      `- Correction: ${CORR}.`,
      `- Scaffolding: ${SCAF}.`,
    );
  } else if (profile.prefs?.slowSpeech) {
    lines.push("", "The learner prefers slower speech — speak noticeably slower with clear pauses.");
  }

  if (s.targetLanguage === "ja") {
    lines.push(
      "",
      "Build up across the session from short words → short phrases → short sentences; each turn nudge a small variation or a new short line. Getting short Japanese out of them beats perfection.",
    );
  }

  if (s.objectives.length) {
    lines.push("", "Steer the conversation so the learner gets to practise:");
    lines.push(...s.objectives.map((o) => `- ${o}`));
  }
  // C1 — objectives the mastery ledger shows the learner hasn't nailed yet get
  // extra weight, so repeated sessions keep working the weak spots (not just
  // whatever the conversation drifts toward).
  if (weakObjectives?.length) {
    lines.push(
      "",
      `From past sessions these objectives still aren't solid — make a point of creating chances to practise them: ${weakObjectives.join("; ")}.`,
    );
  }
  if (s.targetPhrases.length) {
    lines.push("", `Weave in these expressions when they fit: ${s.targetPhrases.join("; ")}.`);
  }
  // Item text is LLM-extracted, not user-reviewed prose — flatten whitespace
  // and cap length so a stray newline/oversized entry can't break the
  // instruction's line structure, and drop entries that sanitise to nothing.
  // W8 — each item carries a fading-scaffold tier from its review history.
  const due = (dueItems ?? [])
    .map((i) => ({ text: i.text.replace(/\s+/g, " ").trim().slice(0, 80), tier: scaffoldTier(i) }))
    .filter((d) => d.text);
  if (due.length) {
    const inTier = (t: string) => due.filter((d) => d.tier === t).map((d) => d.text);
    lines.push(
      "",
      "── Spaced review — make them PRODUCE it, fade help to familiarity (W7/B2/W8) ──",
      "These items are due. Default stance: engineer a moment in the scene that DEMANDS the item and let the LEARNER produce it UNAIDED — never say it first or quiz them in a list. Lead with only as much help as each tier below needs, and recast only if they stall:",
    );
    const model = inTier("model");
    const cue = inTier("cue");
    const indep = inTier("independent");
    if (model.length)
      lines.push(`- Model first (barely seen — model the line in context, have them say it back): ${model.join("; ")}.`);
    if (cue.length)
      lines.push(`- Leading cue (give the first word or leave a gap to fill, let them complete): ${cue.join("; ")}.`);
    if (indep.length)
      lines.push(`- Independent (well-practised — set up the need and let them reach for it unaided): ${indep.join("; ")}.`);
  }
  // The note is the judge's list of grammar/phrase targets, not a plot. Worded
  // as coaching targets so the coach works them in, instead of narrating「上次我們
  // 聊到…」and asking the learner to continue a conversation it cannot see.
  if (s.progressNote) {
    lines.push(
      "",
      `Coaching targets carried over from their last session — work these in naturally; do NOT mention 'last time' or ask them to recall it: ${s.progressNote}`,
    );
  }
  // A standalone scenario run again is a NEW conversation, not a sequel: the
  // previous transcript is not in context, so「接續上次」can only produce vague
  // call-backs and a learner with nothing to say. Vary the situation instead.
  if (priorPlays > 0 && !arc && !s.arc) {
    lines.push(
      "",
      `── This scenario has already been practised ${priorPlays} time${priorPlays > 1 ? "s" : ""} — run a FRESH variation ──`,
      "Do NOT resume, recap or refer back to any previous conversation (you cannot see it). Keep the same frame, roles and objectives, but change ONE concrete thing so there is new material to talk about: a new complication, a different request from your side, a changed number or deadline, a new person joining, or a different outcome you want. Say in your planning sentence what is different this time, then run it as if it were the first time.",
    );
  }
  // E2 — the sounds the coach itself named last time. Continuity only: listen
  // for them and acknowledge improvement; not a list to work through.
  const accent = (profile.accentNotes?.[s.targetLanguage] ?? []).map((n) => n.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean);
  if (accent.length) {
    lines.push(
      "",
      "── Sounds you pointed out last time (listen for them; praise if improved, cue once if not) ──",
      ...accent.map((n) => `- ${n}`),
    );
  }
  if (profile.focus.length) {
    lines.push("", `Pay special attention to their recurring weak spots: ${profile.focus.join(", ")}.`);
  }
  // E1 — measured recurring errors beat the learner's self-declared focus list:
  // these come with the learner's OWN slip and its natural correction, so the
  // coach can create a situation that needs the right form instead of lecturing.
  const recurring = recurringErrors(profile, s.targetLanguage);
  if (recurring.length) {
    lines.push(
      "",
      "── Their measured recurring mistakes (from past sessions) ──",
      "Engineer moments that REQUIRE the correct form, and prompt self-repair when the old habit shows up. Do NOT open by listing these.",
      ...recurring.map(({ type, tally }) => {
        const slip = tally.example ? ` e.g. they said「${tally.example}」` : "";
        const fix = tally.correction ? ` → natural: 「${tally.correction}」` : "";
        return `- ${ERROR_TYPE_LABEL[type]} (${type}), seen in ${tally.count} sessions.${slip}${fix}`;
      }),
    );
  }

  // S2 — story continuity. Placed last so it frames HOW the session opens and
  // closes, which is what makes an episode feel like an episode.
  if (arc) {
    lines.push(
      "",
      `── 這是連續劇《${arc.title}》的第 ${arc.episode} 集（全劇約 ${arc.planned} 集）──`,
      "This scenario is ONE episode of a continuing story. Honour the continuity below exactly: never contradict it, and never re-introduce a character or event the learner has already met as if it were new.",
    );
    if (arc.storyState.characters.length)
      lines.push(
        `- Recurring characters: ${arc.storyState.characters.map((c) => `${c.name} — ${c.note}`).join(" / ")}`,
      );
    if (arc.storyState.events.length)
      lines.push(`- Already happened (oldest first): ${arc.storyState.events.join(" → ")}`);
    if (arc.storyState.openThreads.length)
      lines.push(`- Still unresolved (this episode should move these): ${arc.storyState.openThreads.join("; ")}`);
    lines.push(
      "",
      arc.isFinal
        ? "This is the FINAL episode: steer toward resolving the unresolved threads, and close the story properly at the end."
        : "Near the end, once the objectives are met, follow the Closing order above — do NOT start the next episode. Its last step is ONE short Traditional Chinese sentence teasing what's coming next（下一集預告）so they want to come back.",
    );
  }

  const recap = arc?.recap?.trim();
  if (recap) {
    lines.push(
      "",
      "── 開場順序（照這個順序，不要顛倒）──",
      "1) 前情提要 FIRST — your very FIRST words are the recap, spoken in Traditional Chinese (Taiwan) like a drama's「前情提要」: warm, in AT MOST 3 short sentences, about 20–30 seconds. Deliver exactly this content — you may polish the wording, but add NO new plot and do not mention episode numbers:",
      `「${recap}」`,
      "2) Then the planning beat: in ONE short Traditional Chinese sentence say what you'll practise this episode; offer 1–2 key words/phrases they'll need (with a 繁中 gloss; for Japanese say each slowly, mora by mora); say 「給你幾秒想一下」 and actually leave a brief silent pause (~5 seconds) — do NOT fill it.",
      "3) Then greet them in character and ask your first question.",
      "",
      "Tone: friendly and encouraging, no exam pressure. Begin now.",
    );
  } else {
    lines.push(
      "",
      "── Open with a short planning beat, THEN start (B3) ──",
      "Before the role-play proper: (1) in ONE short Traditional Chinese sentence, say what you'll practise together and why it's useful; (2) offer 1–2 key words/phrases they'll likely need (with a 繁中 gloss; for Japanese say each slowly, mora by mora); (3) say 「給你幾秒想一下」 and actually leave a brief silent pause (~5 seconds) for them to plan — do NOT fill it. Then greet them in character and ask your first question.",
      "",
      "Tone: friendly and encouraging, no exam pressure. Begin now.",
    );
  }

  return lines.join("\n");
}

/**
 * Sent as a text turn the moment a new conversation completes setup. The live
 * model only ever replies; with a silent microphone it would wait forever and
 * the learner would stare at「教練說話中」. Phrased as a stage direction, not as
 * the learner's words, so the transcript rules (echo, help) never see it.
 */
export const OPENING_CUE = "(The learner has put on their headset and is listening. Begin now — your first words open the session.)";

/**
 * Stage directions the session owner sends when the learner stays silent on
 * their turn (session.ts), in escalation order; the last repeats. Written as
 * directions, not as the learner's words, for the same reason as OPENING_CUE.
 * Escalation: first offer a way in, then move the scene on, then narrow to a
 * single easy question — the coach always does the next thing, never re-asks.
 */
const SILENCE_NUDGES: Record<TargetLanguage, readonly string[]> = {
  en: [
    "(The learner has been silent for about 10 seconds — they may just be planning. In ONE short in-character sentence, give them room and an easier way in: either an easier version of your question, or offer an example if they want one. Do not repeat your last line word for word.)",
    "(Still silent. Give TWO short example answers they could pick from, then ask them to say one in their own words.)",
    "(Still silent. Move the scene forward yourself: add a new piece of information or a small complication, then ask ONE simple question about it that can be answered in a few words. If there is still nothing, in one short Traditional Chinese sentence check they are okay.)",
  ],
  // The Japanese learner is usually silent because they cannot ASSEMBLE the
  // line, not because they have nothing to say: every nudge hands them the
  // Japanese to say, explained in Traditional Chinese.
  ja: [
    "(The learner has been silent for about 10 seconds — they probably cannot form the Japanese. In ONE short Traditional Chinese sentence tell them they can first say in Chinese what they want to say, and give ONE short Japanese line they could use here: say it slowly, then mora by mora, with its 繁中 meaning. Ask them to say it. Do not repeat your last line word for word.)",
    "(Still silent. Move the scene forward yourself with ONE short simple Japanese sentence, explain in Traditional Chinese what just happened, and give ONE short Japanese line they can say next — slowly, then mora by mora, with its 繁中 meaning. Ask them to try it.)",
    "(Still silent. In ONE short sentence of Traditional Chinese, check they are okay and give one tiny Japanese word they can say to continue; then wait.)",
  ],
};

/** The silence stage directions for a target language (session.ts sends them). */
export function silenceNudges(lang: TargetLanguage): readonly string[] {
  return SILENCE_NUDGES[lang];
}

/**
 * D3 — everything a Practice screen hands the transport, in one place. A micro
 * session drills ONE focus inside the same scene: it must not also carry due
 * items, weak objectives or the story continuity, or the ninety seconds turn
 * into a second full session. `micro` therefore replaces those inputs rather
 * than adding to them.
 */
export function sessionInstruction(input: {
  scenario: Scenario;
  profile: LearnerProfile;
  dueItems: LearnedItem[];
  weakObjectives: string[];
  arc?: ArcContext;
  priorPlays?: number; // full sessions already run on this scenario → replay = fresh variation
  micro?: string; // the drill block from focus.ts microInstruction, when this is a micro session
}): string {
  if (input.micro !== undefined) {
    return composeSystemInstruction(input.scenario, input.profile, [], [], undefined) + input.micro;
  }
  return composeSystemInstruction(
    input.scenario,
    input.profile,
    input.dueItems,
    input.weakObjectives,
    input.arc,
    input.priorPlays ?? 0,
  );
}
