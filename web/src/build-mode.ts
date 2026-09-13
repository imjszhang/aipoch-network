export type WorkbenchMode = 'unavailable' | 'demo' | 'real';
export function resolveWorkbenchMode(env: Record<string, string | undefined>): WorkbenchMode {
  const requested = env.VITE_WORKBENCH_MODE;
  if (requested !== undefined && !['unavailable', 'demo', 'real'].includes(requested)) throw new Error('Unsupported VITE_WORKBENCH_MODE');
  if (env.VITE_WORKBENCH_DEMO === 'true' && requested !== undefined && requested !== 'demo') throw new Error('Conflicting workbench build modes');
  return requested as WorkbenchMode | undefined ?? (env.VITE_WORKBENCH_DEMO === 'true' ? 'demo' : 'unavailable');
}
/** Explicit build-process choice; runtime URLs, storage and Vite env files cannot change it. */
declare const __AIPOCH_WORKBENCH_MODE__: WorkbenchMode;
export const WORKBENCH_MODE = typeof __AIPOCH_WORKBENCH_MODE__ !== 'undefined'
  ? __AIPOCH_WORKBENCH_MODE__
  : resolveWorkbenchMode(typeof process !== 'undefined' ? process.env : {});
export const DEMO_MODE = WORKBENCH_MODE === 'demo';
