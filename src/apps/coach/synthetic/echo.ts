// Does the coach say one of the learner's target STATEMENTS as its own? A Live
// coach rarely repeats a line word for word; it says the same view in its own
// frame ("for your agents, the human part of the job matters even more now"),
// which still takes the line away from the learner. So a sentence counts when
// it carries nearly all the line's content words, whatever the pronouns and
// glue around them. Exempt: a sentence that hands the line over (a suggestion,
// a repeat request, the closing review), and a recast of what the learner has
// just said, which is the B1 correction the prompt asks for. Question phrases
// are left out: "How does your company handle this?" fits either side's mouth;
// a statement about the learner's own work fits only theirs.

export const SUGGESTS =
  /\b(?:you (?:could|can|might)(?: \w+)? (?:say|try)|let['’]s say|try saying|could you try|repeat|say (?:it|that) (?:again|back)|quick check|review that line)\b/i;

// Live transcripts use curly apostrophes and dashes; compare letters only.
export const norm = (t: string): string =>
  t.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

// Glue and side words: who holds the view is what the coach swaps ("our" →
// "your"), so they cannot decide whether the view itself was said.
const GLUE = new Set(
  "a an the to of in on at by for with as and or but so is are was were be it its it's this that these those i i'm me my we we're our ours us you you're your they their them he she his her".split(
    " ",
  ),
);
const content = (t: string): string[] => norm(t).split(" ").filter((w) => w && !GLUE.has(w));

// A line with fewer content words than this is too short to carry a view, so
// only its exact words count.
const MIN_CONTENT = 3;
const SAME_VIEW = 0.8;

// The learner just said (most of) this phrase: the coach echoing it is a recast.
export function justSaid(phrase: string, previousUser: string): boolean {
  const want = norm(phrase).split(" ");
  const heard = new Set(norm(previousUser).split(" "));
  return want.filter((w) => heard.has(w)).length / want.length >= 0.6;
}

function carries(sentence: string, phrase: string): boolean {
  const want = content(phrase);
  if (want.length < MIN_CONTENT) return norm(sentence).includes(norm(phrase));
  const has = new Set(content(sentence));
  return want.filter((w) => has.has(w)).length / want.length >= SAME_VIEW;
}

// Judged per sentence, so one suggestion does not excuse a line said elsewhere
// in the same turn.
export function parroted(turn: string, phrases: string[], previousUser = ""): string[] {
  const sentences = turn.split(/(?<=[.!?。！？])\s+/).filter((s) => !SUGGESTS.test(s));
  return phrases.filter(
    (p) =>
      !/[?？]\s*$/.test(p) &&
      norm(p).length > 0 &&
      sentences.some((s) => carries(s, p)) &&
      !justSaid(p, previousUser),
  );
}
