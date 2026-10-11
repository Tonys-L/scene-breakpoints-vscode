import { render } from "preact";
import { App } from "./components/App";
import type { CanvasPayload, VsCodeApi } from "./types";

declare function acquireVsCodeApi(): VsCodeApi;

function init() {
	const payloadEl = document.getElementById("sb-payload");
	if (!payloadEl || !payloadEl.textContent) {
		console.error("sb-payload initial data container not found");
		return;
	}

	const payload: CanvasPayload = JSON.parse(payloadEl.textContent);
	const vscode = acquireVsCodeApi();

	const container = document.getElementById("app") || document.body;
	render(<App payload={payload} vscode={vscode} />, container);
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
