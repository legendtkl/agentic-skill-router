import { dciRouteDisabledSkills, type DciRouteOptions } from "./dci.ts";
import { routeDisabledSkills, type RouteDiagnostics, type SkillRouteMatch, type SkillRouteResult } from "./route.ts";
import type { Confidence, Skill } from "./types.ts";

export interface AutoRouteOptions extends DciRouteOptions {}

export async function routeDisabledSkillsAuto(
  skills: Skill[],
  query: string,
  opts: AutoRouteOptions = {},
): Promise<SkillRouteResult> {
  const displayTopK = normalizeAutoTopK(opts.topK);
  const lexical = routeDisabledSkills(skills, query, { topK: Math.max(displayTopK, 2) });
  const escalationReason = autoEscalationReason(lexical);
  const lexicalDiagnostics = diagnosticsForLexical(lexical);
  const visibleLexical = withDisplayedMatches(lexical, displayTopK);

  if (!escalationReason) {
    return {
      ...visibleLexical,
      routeMode: "auto",
      diagnostics: {
        lexical: lexicalDiagnostics,
        auto: { escalated: false, reason: null, selectedSource: lexical.selected ? "lexical" : null },
      },
    };
  }

  const dci = await dciRouteDisabledSkills(skills, query, opts);
  const diagnostics: RouteDiagnostics = {
    lexical: lexicalDiagnostics,
    auto: {
      escalated: true,
      reason: escalationReason,
      selectedSource: dci.selected ? "dci" : null,
    },
  };
  if (dci.diagnostics?.dci) diagnostics.dci = dci.diagnostics.dci;
  return {
    ...dci,
    routeMode: "auto",
    diagnostics,
  };
}

function withDisplayedMatches(result: SkillRouteResult, topK: number): SkillRouteResult {
  return { ...result, matches: result.matches.slice(0, topK) };
}

function autoEscalationReason(result: SkillRouteResult): string | null {
  const selected = result.selected;
  if (!selected) return "lexical-no-confident-match";
  if (isUmbrellaSkill(selected.skill)) return "lexical-selected-umbrella-skill";

  const second = result.matches.find((match) => match.skill.id !== selected.skill.id);
  if (!second) return null;

  if (isSelectable(second.confidence) && selected.score - second.score < 0.12) {
    return "lexical-close-candidates";
  }

  if (
    !selected.signals.matchedPhrase &&
    second.signals.hitCount >= selected.signals.hitCount + 3 &&
    second.score >= 0.3
  ) {
    return "lexical-runner-up-matches-more-query-terms";
  }

  return null;
}

function isUmbrellaSkill(skill: Skill): boolean {
  const text = `${skill.name}\n${skill.description}`.normalize("NFKC").toLowerCase();
  if (/\b(router skill|routes? to subskills?|unified skill|command surface)\b/.test(text)) return true;
  return skill.description.length > 700 && /\bcovers?\b/.test(text);
}

function isSelectable(confidence: Confidence): boolean {
  return confidence === "high" || confidence === "medium";
}

function normalizeAutoTopK(topK: number | undefined): number {
  if (!topK || !Number.isFinite(topK) || topK < 1) return 3;
  return Math.min(Math.floor(topK), 20);
}

function diagnosticsForLexical(result: SkillRouteResult): NonNullable<RouteDiagnostics["lexical"]> {
  return {
    selectedId: result.selected?.skill.id ?? null,
    action: result.selected ? "read-skill-file" : "no-confident-match",
    matches: result.matches.map(projectDiagnosticMatch),
  };
}

function projectDiagnosticMatch(match: SkillRouteMatch): { id: string; confidence: Confidence; score: number; reason: string } {
  return {
    id: match.skill.id,
    confidence: match.confidence,
    score: match.score,
    reason: match.reason,
  };
}
