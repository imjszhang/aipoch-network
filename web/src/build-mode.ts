/** A compile-time value shared by the bundle and build-info, never a URL or stored preference. */
declare const __AIPOCH_WORKBENCH_DEMO__: boolean;
export const DEMO_MODE = typeof __AIPOCH_WORKBENCH_DEMO__ !== 'undefined'
  ? __AIPOCH_WORKBENCH_DEMO__
  : typeof process !== 'undefined' && process.env.VITE_WORKBENCH_DEMO === 'true';
