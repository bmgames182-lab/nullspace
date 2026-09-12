// Compatibility bridge: existing runtime/tests import the v6 symbol, while the
// current implementation lives in v14. V14 preserves the V12 localized reaction
// and physiology stack plus V13 whole-body support-polygon balance, then adds a
// short-lived pre-control disturbance sensor so medium/large external shoves can
// trigger genuine capture-step recovery before support forces hide the impulse.
export { BiologicalArtagdollHumanV14 as BiologicalArtagdollHumanV6 } from "./biological_human_v14.js";
