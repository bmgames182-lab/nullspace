// Compatibility bridge: existing runtime/tests import the v6 symbol, while the
// current implementation lives in v15. V15 preserves the localized reaction,
// physiology, support-polygon balance and impulse-aware capture-step stack, then
// fixes emergency-state recovery hysteresis so a physically recovered body can
// actually return to stable balance instead of staying latched in scramble mode.
export { BiologicalArtagdollHumanV15 as BiologicalArtagdollHumanV6 } from "./biological_human_v15.js";
