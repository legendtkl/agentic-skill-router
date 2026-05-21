export const PLUGIN_NAME: string;
export const MARKETPLACE: string;
export const PLUGIN_KEY: string;

export function stripProxy(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function log(msg: string): void;
export function isPlainObject(value: unknown): value is Record<string, unknown>;
export function ensureBuild(options: {
  repoRoot: string;
  log?: (message: string) => void;
}): void;
