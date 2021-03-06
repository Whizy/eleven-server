'use strict';

module.exports = GameObject;


var _ = require('lodash');
var assert = require('assert');
var config = require('config');
var errors = require('errors');
var orProxy = require('data/objrefProxy');
var util = require('util');
var utils = require('utils');
var RC = require('data/RequestContext');
var RQ = require('data/RequestQueue');
var pers = require('data/pers');


GameObject.prototype.TSID_INITIAL_GAME_OBJECT = 'G';
GameObject.prototype.TSID_INITIAL_BAG = 'B';
GameObject.prototype.TSID_INITIAL_DATA_CONTAINER = 'D';
GameObject.prototype.TSID_INITIAL_GEO = 'G';
GameObject.prototype.TSID_INITIAL_GROUP = 'R';
GameObject.prototype.TSID_INITIAL_ITEM = 'I';
GameObject.prototype.TSID_INITIAL_LOCATION = 'L';
GameObject.prototype.TSID_INITIAL_PLAYER = 'P';
GameObject.prototype.TSID_INITIAL_QUEST = 'Q';

GameObject.prototype.TSID_INITIAL = GameObject.prototype.TSID_INITIAL_GAME_OBJECT;


/**
 * Generic constructor for both instantiating an existing game object
 * (from JSON data), and creating a new object.
 *
 * @param {object} [data] initialization values (properties are
 *        shallow-copied into the game object)
 * @constructor
 * @mixes GameObjectApi
 */
function GameObject(data) {
	if (!data) data = {};
	// initialize TSID/class ID (use deprecated properties if necessary, and
	// keep them as non-enumerable so they are available, but not persisted)
	this.tsid = data.tsid || data.id || utils.makeTsid(this.TSID_INITIAL,
		config.getGsid());
	utils.addNonEnumerable(this, 'id', this.tsid);  // deprecated
	if (data.class_tsid || data.class_id) {
		this.class_tsid = data.class_tsid || data.class_id;
		utils.addNonEnumerable(this, 'class_id', this.class_tsid);  // deprecated
	}
	// add non-enumerable internal properties
	utils.addNonEnumerable(this, '__isGO', true);
	utils.addNonEnumerable(this, 'deleted', false);
	utils.addNonEnumerable(this, 'stale', false);
	// copy supplied data
	orProxy.copyOwnProps(data, this);
	this.ts = this.ts || Date.now();
	if (!this.gsTimers) this.gsTimers = {};
	utils.makeNonEnumerable(this, 'gsTimers');
}

utils.copyProps(require('model/GameObjectApi').prototype, GameObject.prototype);


/**
 * Called by the persistence layer when the object is loaded, right
 * after construction and proxification.
 * **Caution**: Operations in this function (including anything added
 * by subclasses) must not allow yielding before the object is fully
 * loaded, initialized and "ready to use".
 */
GameObject.prototype.gsOnLoad = function gsOnLoad() {
	if (this.onLoad) {
		this.onLoad();
	}
	this.resumeGsTimers();
};


/**
 * Called by the persistence layer when (and only when) an object is initially
 * created.
 */
GameObject.prototype.gsOnCreate = function gsOnCreate() {
	if (this.onCreate) this.onCreate();
};


/**
 * Creates a processed shallow copy of this game object's data,
 * prepared for serialization.
 *
 * The returned data only contains non-function-type direct ("own")
 * properties whose name does not start with a "!". Complex
 * `object`-type properties (specifically, references to other game
 * objects) are not handled separately here, i.e. the caller may need
 * to replace those with appropriate reference structures before actual
 * serialization (see {@link module:data/objrefProxy~refify|
 * objrefProxy.refify}).
 *
 * @returns {object} shallow copy of the game object, prepared for
 *          serialization
 */
GameObject.prototype.serialize = function serialize() {
	var ret = {};
	var keys = Object.keys(this);  // Object.keys only includes own properties
	for (var i = 0; i < keys.length; i++) {
		var k = keys[i];
		if (k[0] !== '!') {
			var val = this[k];
			if (val && val.__isORP || !_.isFunction(val)) {
				ret[k] = val;
			}
		}
	}
	// add timers&intervals (only if there are any)
	var timers;
	for (var key in this.gsTimers) {
		var entry = this.gsTimers[key];
		if (entry.options.internal) continue;  // internal timers are not persisted
		if (!timers) timers = {};
		timers[key] = utils.shallowCopy(entry);
		delete timers[key].handle;  // no point persisting the handles
	}
	if (timers) ret.gsTimers = timers;
	return ret;
};


/**
 * @returns {string}
 */
GameObject.prototype.toString = function toString() {
	return '[' + this.constructor.name + '#' + this.tsid + ']';
};


/**
 * Schedules this object to be released from the live object cache after the
 * current request.
 */
GameObject.prototype.unload = function unload() {
	log.debug('%s.unload', this);
	this.stale = true;
	var rc = RC.getContext(true);
	if (rc) rc.setUnload(this);
};


/**
 * Retrieves the right request queue to process operations on this object.
 * Should be overridden by subclasses when appropriate.
 *
 * @returns {RequestQueue} the request queue for this object
 */
GameObject.prototype.getRQ = function getRQ() {
	return RQ.getGlobal();
};


/**
 * Convenience method: pushes the given function to the request queue this
 * object is currently assigned to. The function will be called with `this`
 * bound to the object.
 *
 * @param {function} func the function to enqueue
 * @param {...*} [args] arbitrary arguments for the `func`
 */
GameObject.prototype.rqPush = function rqPush(func) {
	var args = Array.prototype.slice.call(arguments, 1);
	var f = func.bind.apply(func, [this].concat(args));
	this.getRQ().push(func.name, f, undefined, {obj: this});
};


/**
 * Schedules this object for deletion after the current request.
 */
GameObject.prototype.del = function del() {
	// TODO INFO msg for broken objref debugging, remove when no longer needed:
	log.info('GameObject.del: %s', this);
	this.deleted = true;
	this.unload();
};


/**
 * Helper function originally defined in <gsjs/common.js>. All the
 * functions there should really be added to all game object prototypes
 * in gsjsBridge (then this here wouldn't be necessary), but that would
 * require prefixing a zillion calls in GSJS code with 'this.'.
 * @private
 */
GameObject.prototype.getProp = function getProp(key) {
	return this[key];
};


/**
 * Helper function originally defined in <gsjs/common.js>. All the
 * functions there should really be added to all game object prototypes
 * in gsjsBridge (then this here wouldn't be necessary), but that would
 * require prefixing a zillion calls in GSJS code with 'this.'.
 * @private
 */
GameObject.prototype.setProp = function setProp(key, val) {
	this[key] = val;
};


/**
 * Helper function originally defined in <gsjs/common.js>. All the
 * functions there should really be added to all game object prototypes
 * in gsjsBridge (then this here wouldn't be necessary), but that would
 * require prefixing a zillion calls in GSJS code with 'this.'.
 * @private
 */
GameObject.prototype.setProps = function setProps(props) {
	for (var k in props) {
		this[k] = props[k];
	}
};


/**
 * Schedules a delayed method call via JS timer/interval on the
 * GameObject.
 *
 * @param {object} options parameter object for the call
 * @param {string} options.fname name of the function to call (must be
 *        a property of this game object)
 * @param {int} options.delay delay before, resp. interval between, the
 *        scheduled function call(s) (in ms)
 * @param {array} [options.args] arguments for the function call
 * @param {boolean} [options.interval] schedules an interval if `true`
 *        (`false`, i.e. one-off delayed call, by default)
 * @param {boolean} [options.multi] schedules a "multi" timer if `true`
 *        (allows scheduling multiple calls for the same method;
 *        `false` by default)
 * @param {boolean} [options.internal] schedules an "internal" timer if
 *        `true` (for internal use in the GS, not persistent; `false`
 *        by default)
 * @param {boolean} [options.noCatchUp] if `true`, missed calls are not
 *        executed upon interval resumption (`false` by default; only
 *        relevant for intervals)
 */
GameObject.prototype.setGsTimer = function setGsTimer(options) {
	log.trace('%s.setGsTimer(%s)', this, util.inspect(options, {depth: 1}));
	var logtag = util.format('%s.%s', this, options.fname);
	assert(!(options.multi && options.interval), 'multi intervals not supported');
	assert(_.isFunction(this[options.fname]), 'no such function: ' + logtag);
	if (!options.multi && this.gsTimerExists(options.fname, options.interval, true)) {
		log.trace('timer/interval already set: %s', logtag);
		return;
	}
	// create key to store timer information with (unique for multi timers)
	var key = options.fname;
	if (options.multi) {
		do {
			key = options.fname + '_' + new Date().getTime();
		}
		while (key in this.gsTimers);
	}
	// schedule timer in a separate request context
	var handle = this.scheduleTimer(options, key, this);
	// store data for API functions and saving/restoring timers to/from persistence
	this.gsTimers[key] = {
		handle: handle,
		start: new Date().getTime(),
		options: options,
	};
};


/**
 * Helper function for {@link GameObject#setGsTimer|setGsTimer}.
 * Schedules the (timer driven) function call in the object's request queue
 * (which may be a different one than the current queue).
 *
 * @param {object} options timer call options (see {@link
 *        GameObject#setGsTimer|setGsTimer} for details)
 * @param {string} key unique key for storing/persisting the timer data
 * @private
 */
GameObject.prototype.scheduleTimer = function scheduleTimer(options, key) {
	// eslint-disable-next-line consistent-this
	var self = this.__isORP ? this.__proxyTarget : this;
	if (options.delay > 2147483647) {
		// see https://github.com/joyent/node/issues/3605
		log.error(new errors.DummyError(), 'timer/interval delay too long: %s',
			options.delay);
		options.delay = 2147483647;
	}
	var timerCall = function timerCall() {
		log.trace({options: options}, 'timer call');
		if (self.stale) {
			log.debug('aborting timer call on stale object %s', self.tsid);
			return;
		}
		if (!options.interval) {
			delete self.gsTimers[key];
		}
		try {
			self.gsTimerExec(options);
		}
		catch (e) {
			delete self.gsTimers[key];  // clean up
			log.error(e, 'error calling %s.%s (interval: %s)', self,
				options.fname, !!options.interval);
			// don't rethrow - we want to make sure the offending
			// timer/interval is not called again upon unload/reload
			return;
		}
		// schedule next interval iteration (unless it was canceled)
		if (self.gsTimers[key] && options.interval) {
			delete self.gsTimers[key];
			self.setGsTimer(options);
		}
	};
	var execTimer = function execTimer() {
		if (self.stale) {
			log.debug('dropping timer call on stale object %s', self.tsid);
			return;
		}
		var rq;
		try {
			rq = self.getRQ();
			log.trace('RQ for %s.%s: %s', self, options.fname, rq);
		}
		catch (e) {
			log.error(e, 'could not get RQ for %s.%s', self.tsid, options.fname);
			return;
		}
		var rqEntry = rq.push(options.fname, timerCall, function callback(e) {
			if (e) {
				log.error(e, 'error calling %s.%s (interval: %s)', self,
					options.fname, !!options.interval);
			}
		}, {obj: self});
		if (self.gsTimers[key]) self.gsTimers[key].handle = rqEntry;
	};
	return setTimeout(execTimer, options.delay);
};


/**
 * Actually performs a scheduled function call according to a
 * timer/interval options record.
 *
 * @param {object} options timer call options (see {@link
 *        GameObject#setGsTimer|setGsTimer} for details)
 * @private
 */
GameObject.prototype.gsTimerExec = function gsTimerExec(options) {
	this[options.fname].apply(this, options.args);
};


/**
 * Checks if a timer/interval is currently defined for a given method.
 *
 * @param {string} fname name of the method to check
 * @param {boolean} [interval] if `true`, checks if an interval call is
 *        defined for the given function (otherwise checks for a timer)
 * @param {boolean} [active] if `true`, don't just check if the timer
 *        is configured, but also if it has actually been started
 * @returns {boolean} `true` if an interval/timer call is scheduled
 */
GameObject.prototype.gsTimerExists = function gsTimerExists(fname, interval, active) {
	var entry = this.gsTimers[fname];
	if (entry) {
		if (entry.options.interval && interval || !entry.options.interval && !interval) {
			return !active || 'handle' in entry;
		}
	}
	return false;
};


/**
 * Suspends all currently active timers/intervals on the object.
 * Called from the persistence layer before unloading an object.
 */
GameObject.prototype.suspendGsTimers = function suspendGsTimers() {
	for (var key in this.gsTimers) {
		var entry = this.gsTimers[key];
		if (entry.handle) {
			log.debug('suspending %s.%s', this, key);
			clearTimeout(entry.handle);
			delete entry.handle;
		}
	}
};


/**
 * Resumes timers/intervals, catching up on missed calls (should be
 * called after loading the object from persistence).
 */
GameObject.prototype.resumeGsTimers = function resumeGsTimers() {
	var now = new Date().getTime();
	for (var key in this.gsTimers) {
		var entry = this.gsTimers[key];
		if (entry.handle) {
			// skip internal stuff that's already running (e.g. started in constructor)
			log.debug('%s.%s already running', this, key);
			continue;
		}
		log.debug('resuming %s.%s', this, key);
		var age = now - entry.start;
		if (!entry.options.interval) {
			// reschedule with adjusted delay
			entry.options.delay = Math.max(entry.options.delay - age, 1);
			this.setGsTimer(entry.options);
		}
		else {
			// perform catch-up calls
			var num = Math.floor(age / entry.options.delay);
			if (num > 0 && !entry.options.noCatchUp) {
				log.debug('interval catching up (%s call(s))', num);
				for (var i = 0; i < num && !this.deleted; i++) {
					this.gsTimerExec(entry.options, num);
				}
			}
			// if not deleted while catching up (e.g. trant death), actually
			// resume interval
			if (!this.deleted) {
				// schedule next call with shortened interval
				var nextDelay = entry.options.delay - age % entry.options.delay;
				this.setGsTimer({
					fname: entry.options.fname,
					delay: nextDelay,
					args: entry.options.args,
					multi: true,
					internal: true,
				});
				// schedule postponed start of the regular interval, inception-style
				var intStartOpts = {
					fname: 'setGsTimer',
					delay: nextDelay,
					args: [entry.options],
					multi: true,
					internal: true,
				};
				this.setGsTimer(intStartOpts);
			}
		}
		if (entry.options.multi) {
			// as we have made a new multi timer in setGsTimer, delete the old one
			delete this.gsTimers[key];
		}
	}
};


/**
 * Cancels a scheduled timer call, resp. clears an interval call.
 *
 * @param {string} fname name of the method whose timer/interval call
 *        should be canceled
 * @param {boolean} [interval] if `true`, cancels an interval call for
 *        the given function, otherwise a timer
 * @returns {boolean} `true` if a scheduled timer/interval was actually
 *          canceled
 */
GameObject.prototype.cancelGsTimer = function cancelGsTimer(fname, interval) {
	var ret = false;
	var entry = this.gsTimers[fname];
	if (entry && !!entry.options.interval === !!interval) {
		if (entry.handle) {
			if (entry.handle.tag && entry.handle.func) {
				// already a request queue entry; flag it as canceled
				entry.handle.canceled = true;
			}
			else {
				// still a pending timeout, so just clear it
				clearTimeout(entry.handle);
			}
			ret = true;
		}
		delete this.gsTimers[fname];
	}
	return ret;
};


/**
 * Checks if there are any pending timers calls/active interval calls
 * on this object.
 *
 * @returns {boolean} `true` if there are active timers/intervals
 */
GameObject.prototype.hasActiveGsTimers = function hasActiveGsTimers() {
	for (var key in this.gsTimers) {
		if (this.gsTimers[key].handle) return true;
	}
	return false;
};


/**
 * Copies non-function-type direct properties of another object onto this one
 * (overwriting existing properties with the same name). Regular objects and
 * arrays are deep-copied, whereas game objects (including objrefs) are copied
 * by reference.
 *
 * @param {GameObject} from copy source
 * @param {array} [skipList] list of property names to skip (in addition to
 *        `tsid`, which is always implicitly skipped)
 */
GameObject.prototype.copyProps = function copyProps(from, skipList) {
	for (var key in from) {
		if (!from.hasOwnProperty(key)) continue;
		if (key === 'tsid') continue;
		if (skipList && skipList.indexOf(key) !== -1) continue;
		var val = from[key];
		if (_.isFunction(val)) continue;
		// directly copy primitive types
		if (!(val instanceof Object)) {
			this[key] = val;
		}
		else if (val.__isORP || val.__isGO) {
			// don't resolve/follow objref proxies (just copy them)
			this[key] = val;
		}
		else {
			// recursive call for objects and arrays
			this[key] = _.isArray(val) ? [] : {};
			// skipList omitted on purpose - we only want to exclude those
			// properties on the first level
			GameObject.prototype.copyProps.call(this[key], val);
		}
	}
};


/**
 * Updates the object with data from a javascript object.
 * Used by god page updates.
 *
 * @param {object} data update source
 */
GameObject.prototype.updateProps = function updateProps(newData) {
	var updateSub = function updateSub(start, data) {
		var changed = false;
		for (var k in data) {
			var v = data[k];
			if (typeof v === 'object') {
				if (v.__isORP || v.__isGO) {
					if (start[k].tsid !== v.tsid) {
						log.debug('changing objref from %s to %s', start[k], v);
						start[k] = v;
						changed = true;
					}
				}
				else if (typeof start[k] === 'object') {
					if (updateSub(start[k], v)) {
						changed = true;
					}
				}
				else {
					log.debug('type mismatch: %s vs. %s', typeof v, typeof start[k]);
				}
			}
			else if (start[k] !== v) {
				log.trace('changing %s from %s to %s', k, start[k], v);
				start[k] = v;
				changed = true;
			}
		}
		return changed;
	};

	if (updateSub(this, newData)) {
		if (utils.isItem(this)) {
			this.setXY(this.x, this.y);
			this.queueChanges();
		}
		if (this.onPropsChanged) {
			this.onPropsChanged();
		}
		if (this.broadcastState) {
			this.broadcastState();
		}
	}
};


/**
 * Gets the TSID of the {@link Geo} object for this location.
 *
 * @returns {string} TSID of the corresponding {@link Geo} object
 */
GameObject.prototype.getLocTsid = function getLocTsid() {
	return this.TSID_INITIAL_LOCATION + this.tsid.slice(1);
};



/**
 * Updates the current object with data from the passed in object.
 * If the current object is a Geo, have the corresponding Location
 * process the change.
 *
 * @param {GameObject} data copy source
 */
GameObject.prototype.replaceDynamic = function replaceDynamic(data) {
	this.copyProps(data);
	if (utils.isGeo(this)) {
		var loc = pers.get(this.getLocTsid());
		loc.updateGeo(this);
	}
};
