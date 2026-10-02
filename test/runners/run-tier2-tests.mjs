import { runFingerprintVoTests } from "../unit/domain/models/fingerprint.test.mjs";
import { runBreakpointEntityTests } from "../unit/domain/models/breakpoint.test.mjs";
import { runConfigTests } from "../unit/domain/models/scene.test.mjs";
import { runSceneAndCatalogTests } from "../unit/domain/models/scene_catalog.test.mjs";

runFingerprintVoTests();
runBreakpointEntityTests();
runConfigTests();
runSceneAndCatalogTests();

