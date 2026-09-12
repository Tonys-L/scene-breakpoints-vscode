import { clearAllPolicy } from "../../../policy/clearAllPolicy";
import { getWorkspaceRoot } from "../../storage/jsonFileSceneRepository";

export async function clearAllCommand(): Promise<void> {
	const workspaceRoot = getWorkspaceRoot(false);
	await clearAllPolicy({ workspaceRoot });
}
