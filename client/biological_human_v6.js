// Compatibility bridge: existing runtime/tests import the v6 symbol, while the
// current implementation lives in v13. V13 preserves the directed localized
// reactions and physiology stack from v12, then adds whole-body COM/support-
// polygon balance, compliant ankle/hip control, procedural recovery stepping,
// planted-foot control, torso counter-rotation and active arm balancing.
export { BiologicalArtagdollHumanV13 as BiologicalArtagdollHumanV6 } from "./biological_human_v13.js";
