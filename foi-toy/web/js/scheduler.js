export default Scheduler;
export { Scheduler };


// ***********************

function Scheduler(debounceMin,throttleMax) {
	var entries = new WeakMap();

	return schedule;


	// ***********************

	function schedule(fn) {
		var entry;

		if (entries.has(fn)) {
			entry = entries.get(fn);
		}
		else {
			entry = {
				last: 0,
				timer: null,
			};
			entries.set(fn,entry);
		}

		var now = Date.now();

		if (!entry.timer) {
			entry.last = now;
		}

		if (
			// no timer running yet?
			entry.timer == null ||
			// room left to debounce while still under the throttle-max?
			(now - entry.last) < throttleMax
		) {
			if (entry.timer) {
				clearTimeout(entry.timer);
			}

			let time = Math.min(debounceMin,Math.max(0,(entry.last + throttleMax) - now));
			entry.timer = setTimeout(run,time,fn,entry);
		}

		if (!entry.cancelFn) {
			entry.cancelFn = function cancel(){
				if (entry.timer) {
					clearTimeout(entry.timer);
					entry.timer = entry.cancelFn = null;
				}
			};
		}
		return entry.cancelFn;
	}

	function run(fn,entry) {
		entry.timer = entry.cancelFn = null;
		entry.last = Date.now();
		fn();
	}
}
