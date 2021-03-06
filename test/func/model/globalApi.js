'use strict';

var rewire = require('rewire');
var globalApi = rewire('model/globalApi');
var gsjsBridge = require('model/gsjsBridge');
var pers = require('data/pers');
var RC = require('data/RequestContext');
var pbeMock = require('../../mock/pbe');
var Item = require('model/Item');
var Geo = require('model/Geo');
var IdObjRefMap = require('model/IdObjRefMap');
var Location = require('model/Location');
var Player = require('model/Player');


suite('globalApi', function () {

	setup(function () {
		gsjsBridge.init(true);
		pers.init(pbeMock);
	});

	teardown(function () {
		gsjsBridge.reset();
		pers.init();  // disable mock back-end
	});


	suite('callFor', function () {

		var callFor = globalApi.__get__('callFor');

		test('works as expected', function (done) {
			new RC().run(function () {
				var i1 = Item.create('apple');
				var i2 = Item.create('pi');
				var res = callFor('toString', [i1.tsid, i2.tsid]);
				var expected = {};
				expected[i1.tsid] = {ok: 1, tsid: i1.tsid, res: i1.toString()};
				expected[i2.tsid] = {ok: 1, tsid: i2.tsid, res: i2.toString()};
				assert.deepEqual(res, expected);
			}, done);
		});

		test('filters out offline players', function (done) {
			var rc = new RC();
			rc.run(function () {
				var p1 = new Player({location: {tsid: 'LDUMMY'}});
				rc.cache[p1.tsid] = p1;
				p1.session = 'notnull';  // just to trick Player.isConnected
				var p2 = new Player({location: {tsid: 'LDUMMY'}});
				rc.cache[p2.tsid] = p2;
				p1.send = function (arg) {
					assert.strictEqual(arg, 'blerch');
					return {zerg: 'mooh'};
				};
				p2.send = function () {
					// p2 has no session, should be skipped
					throw new Error('this should not be called');
				};
				var res = callFor('send', [p1, p2], ['blerch'], true);
				var expected = {};
				expected[p1.tsid] = {ok: 1, tsid: p1.tsid, zerg: 'mooh'};
				expected[p2.tsid] = {ok: 0, offline: true};
				assert.deepEqual(res, expected);
			}, done);
		});

		test('handles errors gracefully and filters object types', function (done) {
			var rc = new RC();
			rc.run(function () {
				var i = Item.create('apple');  // not a player, will be skipped
				var p = new Player({location: {tsid: 'LDUMMY'}});
				rc.cache[p.tsid] = p;
				p.session = 'notnull';  // just to trick Player.isConnected
				p.foo = function (arg1, arg2) {
					throw new Error(arg1 + ' ' + arg2);
				};
				var res = callFor('foo', [i, p], ['annoyed', 'grunt'], true);
				var expected = {};
				expected[p.tsid] = {ok: 0, error: 'Error: annoyed grunt'};
				assert.deepEqual(res, expected);
			}, done);
		});
	});


	suite('apiCopyHash', function () {

		this.slow(500);

		test('does not clone referenced game objects', function (done) {
			var copyHash = globalApi.apiCopyHash;
			new RC().run(function () {
				var i = Item.create('apple');
				var o = {apple: i};
				assert.strictEqual(copyHash(i), i);
				assert.strictEqual(copyHash(i).constructor.name, 'apple');
				assert.strictEqual(copyHash(o.apple), i);
			}, done);
		});
	});


	suite('apiGetObjectContent', function () {

		this.slow(500);

		test('clones referenced game objects', function (done) {
			var getObjContent = globalApi.apiGetObjectContent;
			var rc = new RC();
			rc.run(function () {
				var i = Item.create('apple');
				var l = Location.create(Geo.create());
				l.addItem(i, 0, 0);
				rc.cache[i.tsid] = i;
				rc.cache[l.tsid] = l;
				assert.notStrictEqual(getObjContent(i.tsid), i);
				assert.notStrictEqual(getObjContent(l.tsid).items[i.tsid], i);
				assert.strictEqual(getObjContent(i.tsid).constructor.name, 'Object');
			}, done);
		});
	});


	suite('apiNewLocation', function () {

		this.slow(500);

		test('works as expected', function (done) {
			new RC().run(function () {
				var loc = globalApi.apiNewLocation('therock', 12, 'POL_foo', 'tower');
				assert.instanceOf(loc, Location);
				assert.instanceOf(loc.geometry, Geo);
				assert.isString(loc.tsid);
				assert.strictEqual(loc.tsid.substr(1), loc.geometry.tsid.substr(1));
				assert.strictEqual(loc.constructor.name, 'tower');
				assert.strictEqual(loc.class_tsid, 'tower');
				assert.strictEqual(loc.hubid, 'POL_foo');
				assert.strictEqual(loc.moteid, 12);
				assert.instanceOf(loc.players, IdObjRefMap);
				assert.instanceOf(loc.items, IdObjRefMap);
				assert.isFunction(loc.jobs_is_auto_unlock);  // inherited from location.js
				assert.isFunction(loc.tower_init);  // inherited from tower.js
			}, done);
		});
	});


	suite('apiFindGlobalPathX', function () {

		test('returns an empty list when something went wrong', function (done) {
			new RC().run(function () {
				var path = globalApi.apiFindGlobalPathX();
				assert.deepEqual(path, [], 'both params missing');
				path = globalApi.apiFindGlobalPathX('foo', 'bar');
				assert.deepEqual(path, [], 'invalid TSIDs');
				path = globalApi.apiFindGlobalPathX('foo', 'bar');
				assert.deepEqual(path, [], 'invalid TSIDs');
				path = globalApi.apiFindGlobalPathX('LA9DNT3I2U22RS7');
				assert.deepEqual(path, [], 'only "from" was a valid TSID');
				path = globalApi.apiFindGlobalPathX('', 'LA9DNT3I2U22RS7');
				assert.deepEqual(path, [], 'only "to" was a valid TSID');
				path = globalApi.apiFindGlobalPathX('LA9DNT3I2U22RS7', 'LA9DNT3I2U22RS7');
				assert.deepEqual(path, [], '"from" and "to" are the same street');
			}, done);
		});

		test('finds the shortest path from one street to another', function (done) {
			new RC().run(function () {
				var path = globalApi.apiFindGlobalPathX('LA9DNT3I2U22RS7', 'LA9QKFSST732VNK');
				assert.deepEqual(path, [{to: 5, tsid: 'LA9DNT3I2U22RS7'}, {from: 5, tsid: 'LA9QKFSST732VNK'}], 'Nandak Intention to Punpun Snug (1 street)');
				var expected = [{
					tsid: 'LDOFE9L72S03U5T',
					to: 5,
				},
				{
					tsid: 'LDORU6QC6S035VQ',
					to: 5,
					from: 5,
				},
				{
					tsid: 'LDO3QTOUUR03ELC',
					to: 5,
					from: 5,
				},
				{
					tsid: 'LDO42D61VR03PM6',
					to: 5,
					from: 5,
				},
				{
					tsid: 'LDOF4NU42S03R63',
					to: 5,
					from: 5,
				},
				{
					tsid: 'LDO38FFPUR035D6',
					to: 5,
					from: 5,
				},
				{
					tsid: 'LUVSMJ94HKF2V3J',
					from: 5,
				}];
				path = globalApi.apiFindGlobalPathX('LDOFE9L72S03U5T', 'LUVSMJ94HKF2V3J');
				assert.deepEqual(path, expected, 'Tamasco Roko to Karka Dakam (6 streets, different maps)');
			}, done);
		});

		test('finds the shortest path from one street to one of many other streets', function (done) {
			new RC().run(function () {
				var path = globalApi.apiFindShortestGlobalPath('LA9DNT3I2U22RS7', ['LA9QKFSST732VNK', 'LDOFE9L72S03U5T']);
				assert.deepEqual(path, [{to: 5, tsid: 'LA9DNT3I2U22RS7'}, {from: 5, tsid: 'LA9QKFSST732VNK'}], 'Nandak Intention to Punpun Snug (1 street) should be shorter than the path to Tamasco Roko');
			}, done);
		});
	});
});
