// What members read about a comparison. The AI never writes it. A room admin's free-text
// rules (custom purpose/strategy, additional guidance, the legacy ai_prompt) go into the
// comparison prompt as instructions, so a rule like "in the summary, paraphrase secret A"
// would otherwise put one member's secret in front of the room admin and the other member.
// The summary is a fixed sentence picked from the outcome and the room's matching strategy.
const MATCH_SUMMARIES = {
  topic: 'Both secrets are about the same subject.',
  feeling: 'Both secrets carry the same core feeling.',
  weight: 'Both secrets carry a similar weight.',
  vibe: 'Both secrets share the same vibe.',
  exact: 'Both secrets are about the same specific thing.',
};
const MATCH_SUMMARY = "These secrets match under this room's rules.";
const NO_MATCH_SUMMARY = "These secrets didn't match under this room's rules.";
export const FAILED_SUMMARY = 'Intelligence analysis failed for this pair.';
export const QUOTA_SUMMARY = 'AI Rate Limit/Quota exceeded. Please check your API billing or wait before retrying.';

export function comparisonSummary(matched, roomConfig) {
  if (!matched) return NO_MATCH_SUMMARY;
  return MATCH_SUMMARIES[roomConfig?.strategy] || MATCH_SUMMARY;
}

const FIXED_SUMMARIES = new Set([
  ...Object.values(MATCH_SUMMARIES), MATCH_SUMMARY, NO_MATCH_SUMMARY, FAILED_SUMMARY, QUOTA_SUMMARY,
]);

// Rows stored before this rule hold summaries the AI wrote. Members only ever get one of
// the fixed sentences: anything else becomes the plain one for its outcome.
export function safeSummary(summary, matched) {
  return FIXED_SUMMARIES.has(summary) ? summary : comparisonSummary(matched);
}
