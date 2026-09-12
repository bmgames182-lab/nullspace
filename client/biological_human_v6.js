// Compatibility bridge: existing runtime/tests import the v6 symbol, while the
// current implementation lives in v11 with directed reactions and conscious
// ground guarding instead of scripted limp collapse.
export { BiologicalArtagdollHumanV11 as BiologicalArtagdollHumanV6 } from "./biological_human_v11.js";
