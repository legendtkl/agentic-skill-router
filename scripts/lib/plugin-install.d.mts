export const RUNTIME_ASSET_DIRS: readonly string[];
export const HOST_ENTRY_ASSET_DIRS: readonly string[];

export function copyPluginAssets(options: {
  pluginSrc: string;
  repoRoot: string;
  installPath: string;
  sharedAssetDirs?: readonly string[];
}): Promise<void>;

export function copyRuntimeAssets(options: {
  repoRoot: string;
  runtimePath: string;
  runtimeAssetDirs?: readonly string[];
}): Promise<void>;

export function writeHostWrapper(options: {
  wrapperPath: string;
  runtimeBin: string;
  hostName: "claude-code" | "codex";
  assetRoot?: string;
}): Promise<void>;

export function normalizeManifestSkills(manifestPath: string): Promise<void>;

export function cleanupOldVersions(
  cacheRoot: string,
  currentVersion: string,
  options?: {
    keepOld?: boolean;
    log?: (message: string) => void;
  },
): Promise<void>;

export interface DisabledSkillRecord {
  id: string;
  [key: string]: unknown;
}

export function warnAboutDisabledSkills(options: {
  statePath: string;
  warnPrefix: string;
  formatRestoreHint: (records: DisabledSkillRecord[]) => string[];
  reportMalformed?: boolean;
  log?: (message: string) => void;
}): Promise<void>;
