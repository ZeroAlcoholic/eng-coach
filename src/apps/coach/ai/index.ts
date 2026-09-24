// Text-model capabilities for the coach. One file per capability (prompt +
// response schema + validator), all going through client.ts. Adding a
// capability = adding a file here and re-exporting it; nothing else changes.
// The live voice loop is src/api/gemini-direct.ts, not this folder.

export { validateApiKey, Invalid } from "./client";
export { generateScenario } from "./scenario";
export { extractLearnedItems } from "./items";
export { summariseSession, type JudgeOutcome } from "./review";
export { suggestReplies, type ReplySuggestion } from "./replies";
export { translateLine } from "./translate";
export { generateReviewExtras, type ReviewExtras } from "./extras";
export {
  generateArcSeed,
  generateNextEpisode,
  type ArcSeed,
  type EpisodeDraft,
  type EpisodeGeneration,
} from "./arc";
export type { SessionReview } from "../../../kernel/types";
