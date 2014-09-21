'use strict';

var async = require('async');
var net = require('net');
var config = require('config');
var sessionMgr = require('comm/sessionMgr');


suite('Session', function() {
	
	var server;
	var cfg = config.getGSConf('gs01-01');
	
	suiteSetup(function() {
		sessionMgr.init();
		server = net.createServer(function(socket) {
			sessionMgr.newSession(socket, function dataHandler(session, data) {
				socket.write(data);  // simple echo
			});
		}).listen(cfg.port, cfg.host);
	});
	
	suiteTeardown(function() {
		server.close();
		sessionMgr.init();
	});
	
	
	suite('connection and data transmission', function() {
	
		this.timeout(5000);
		this.slow(2000);
		
		test('works as expected over local TCP connection', function(done) {
			var sock = net.connect(cfg.port, cfg.host);
			sock.on('data', function (data) {
				assert.strictEqual(data.toString(), 'foo');
				sock.end();
			});
			sock.on('close', function () {
				assert.strictEqual(sessionMgr.getSessionCount(), 0);
				done();
			});
			sock.write('foo');
		});
		
		test('works with a number of concurrent connections', function(done) {
			var numbers = Array.apply(null, {length: 1000}).map(Number.call, Number);
			async.eachLimit(numbers, 10,
				function iterator(i, cb) {
					net.connect(cfg.port, cfg.host)
						.on('data', function (data) {
							assert.equal(data.toString(), i);
							this.end();
						})
						.on('close', function (hadError) {
							cb(hadError);
						})
						.write('' + i);
				},
				function callback(err) {
					assert.strictEqual(sessionMgr.getSessionCount(), 0);
					done(err);
				}
			);
		});
	});
});