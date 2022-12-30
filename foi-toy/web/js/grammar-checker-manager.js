"use strict";

var grammar;
var workerQueue = [];
const QUEUE_LENGTH = 3;

self.addEventListener("message",onParentMessage);


// ****************************

function addWorker() {
	var worker = new Worker("/js/grammar-checker-worker.js");
	worker.addEventListener("message",onWorkerMessage);
	// initialize the worker with the grammar
	if (grammar != null) {
		worker.postMessage({ grammar, });
	}
	workerQueue.push({ pending: false, worker, });
}

function onParentMessage({ data }) {
	if (data.grammar) {
		if (grammar == null) {
			grammar = data.grammar;
		}
		delete data.grammar;
	}

	if (
		workerQueue.length > 0 &&
		workerQueue[0].pending &&
		(data.stop || data.input)
	) {
		let curWorker = workerQueue.shift();
		addWorker();
		curWorker.worker.removeEventListener("message",onWorkerMessage);
		curWorker.worker.terminate();
		curWorker.pending = false;
	}

	if (data.input) {
		// prime the worker queue (if needed)
		while (workerQueue.length < QUEUE_LENGTH) {
			addWorker();
		}

		workerQueue[0].pending = true;
		workerQueue[0].worker.postMessage(data);
	}
}

function onWorkerMessage({ data }) {
	workerQueue[0].pending = false;
	self.postMessage(data);
}
