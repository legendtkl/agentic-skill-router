import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const SKILLROUTER_EVAL_CORE_ENV = "SKILLROUTER_EVAL_CORE";

export function defaultSkillRouterEvalCorePath() {
  const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cacheHome, "skill-router", "datasets", "SkillRouter-Eval-Core", "eval_core");
}

export function skillRouterEvalCorePath(raw = process.env[SKILLROUTER_EVAL_CORE_ENV] || "") {
  const value = raw.trim();
  if (value === "" || value === "1" || value === "true" || value === "default") {
    return defaultSkillRouterEvalCorePath();
  }
  const expanded = expandHome(value);
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export function optionalSkillRouterEvalCorePath(...envNames) {
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value && value.trim()) return skillRouterEvalCorePath(value);
  }
  return "";
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}
