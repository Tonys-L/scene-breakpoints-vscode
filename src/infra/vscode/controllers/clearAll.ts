import { clearAllUseCase } from "../../../application/clearAllUseCase";
import { getWorkspaceRoot } from "../../storage/jsonFileSceneRepository";

export async function clearAllCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(false);
	await clearAllUseCase({ workspaceRoot });
}
