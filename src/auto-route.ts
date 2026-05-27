import { dciRouteDisabledSkills, type DciRouteOptions } from "./dci.ts";
import {
  hasDistinctiveMetadataEvidence,
  isMetadataUmbrellaSkill,
  routeDisabledSkillsMetadata,
} from "./metadata-route.ts";
import type { RouteDiagnostics, SkillRouteMatch, SkillRouteResult } from "./route.ts";
import type { Confidence } from "./types.ts";

export interface AutoRouteOptions extends DciRouteOptions {}

export async function routeDisabledSkillsAuto(
  skills: Parameters<typeof routeDisabledSkillsMetadata>[0],
  query: string,
  opts: AutoRouteOptions = {},
): Promise<SkillRouteResult> {
  const displayTopK = normalizeAutoTopK(opts.topK);
  const metadata = routeDisabledSkillsMetadata(skills, query, { topK: Math.max(displayTopK, 2) });
  const escalationReason = metadataEscalationReason(metadata);
  const metadataDiagnostics = diagnosticsFor(metadata);
  const visibleMetadata = withDisplayedMatches(metadata, displayTopK);

  if (!escalationReason) {
    return {
      ...visibleMetadata,
      routeMode: "auto",
      diagnostics: {
        metadata: metadataDiagnostics,
        auto: { escalated: false, reason: null, selectedSource: metadata.selected ? ("metadata" as const) : null },
      },
    };
  }

  const body = await dciRouteDisabledSkills(skills, query, opts);
  const diagnostics: RouteDiagnostics = {
    metadata: metadataDiagnostics,
    auto: {
      escalated: true,
      reason: escalationReason,
      selectedSource: body.selected ? "dci" : null,
    },
  };
  if (body.diagnostics?.dci) diagnostics.dci = body.diagnostics.dci;

  if (!body.selected && body.matches.length === 0) {
    return {
      ...visibleMetadata,
      selected: null,
      routeMode: "auto",
      diagnostics,
    };
  }

  return {
    ...body,
    routeMode: "auto",
    diagnostics,
  };
}

function withDisplayedMatches(result: SkillRouteResult, topK: number): SkillRouteResult {
  return { ...result, matches: result.matches.slice(0, topK) };
}

function metadataEscalationReason(result: SkillRouteResult): string | null {
  const selected = result.selected;
  if (!selected) return "metadata-no-confident-match";
  if (selected.confidence !== "high") return "metadata-not-high-confidence";
  if (!hasDistinctiveMetadataEvidence(selected)) return "metadata-lacks-distinctive-evidence";

  const second = result.matches.find((match) => match.skill.id !== selected.skill.id);
  if (
    isMetadataUmbrellaSkill(selected.skill) &&
    (!selected.signals.matchedName ||
      (second && second.signals.cueHitCount >= selected.signals.cueHitCount + 3 && second.score >= 0.3))
  ) {
    return "metadata-selected-umbrella-skill";
  }
  if (second && isSelectable(second.confidence) && selected.score - second.score < 0.12) {
    return "metadata-close-candidates";
  }

  return null;
}

function isSelectable(confidence: Confidence): boolean {
  return confidence === "high" || confidence === "medium";
}

function normalizeAutoTopK(topK: number | undefined): number {
  if (!topK || !Number.isFinite(topK) || topK < 1) return 3;
  return Math.min(Math.floor(topK), 20);
}

function diagnosticsFor(result: SkillRouteResult): NonNullable<RouteDiagnostics["metadata"]> {
  return {
    selectedId: result.selected?.skill.id ?? null,
    action: result.selected ? "read-skill-file" : "no-confident-match",
    matches: result.matches.map(projectDiagnosticMatch),
  };
}

function projectDiagnosticMatch(match: SkillRouteMatch): {
  id: string;
  confidence: Confidence;
  score: number;
  reason: string;
} {
  return {
    id: match.skill.id,
    confidence: match.confidence,
    score: match.score,
    reason: match.reason,
  };
}
