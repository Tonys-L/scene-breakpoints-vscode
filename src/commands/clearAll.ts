import { clearAllBreakpoints } from "../breakpointAdapter";
import { sceneStateManager } from "../sceneStateManager";

export async function clearAllCommand(): Promise<void> {
	await clearAllBreakpoints();
	sceneStateManager.setActiveScene(undefined);
}
