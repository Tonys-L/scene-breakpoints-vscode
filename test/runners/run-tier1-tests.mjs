import { runHealingTests } from "../unit/domain/services/healing_engine.test.mjs";
import { runScenePayloadCodecTests } from "../unit/domain/services/scene_payload_codec.test.mjs";
import { runAiActivationTests } from "../unit/domain/services/active_scenes_diff_resolver.test.mjs";

runHealingTests();
runScenePayloadCodecTests();
runAiActivationTests();

