import { clearAll } from "../../../application/clearAll";
import { getWorkspaceRoot } from "../../storage/jsonFileSceneRepository";

export async function clearAllCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(false);
	await clearAll({ workspaceRoot });
}
