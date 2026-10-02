import { runSerialQueueTests } from "../unit/application/serial_queue.test.mjs";
import { runEchoLoopGuardTests } from "../unit/infra/storage/echo_loop_guard.test.mjs";
import { runFileLineReaderTests } from "../unit/infra/storage/file_line_reader.test.mjs";
import { runAtomicFileJsonStoreTests } from "../unit/infra/storage/atomic_file_json_store.test.mjs";

async function main() {
	await runSerialQueueTests();
	await runEchoLoopGuardTests();
	await runFileLineReaderTests();
	await runAtomicFileJsonStoreTests();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
