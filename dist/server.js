/*jshint esnext:true, node: true */
'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _connect = require('connect');

var _connect2 = _interopRequireDefault(_connect);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _http = require('http');

var _http2 = _interopRequireDefault(_http);

// import https from 'https';

var _mkdirp = require('mkdirp');

var _mkdirp2 = _interopRequireDefault(_mkdirp);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _pathToRegexp = require('path-to-regexp');

var _pathToRegexp2 = _interopRequireDefault(_pathToRegexp);

var _configJs = require('../config.js');

var _configJs2 = _interopRequireDefault(_configJs);

var portExp = /:\d+$/;
var verbose = !!_configJs2['default'].verbose;
var proxyRemovedHeaders = ['host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
var proxyBackupRemovedHeaders = ['if-modified-since', // avoid getting 304 response on browser refresh
'accept-encoding' // we want human readable content
];

var serverHttpPort = 3000;

// map config paths to regexps
Object.keys(_configJs2['default']).forEach(function (hostKey) {
	_configJs2['default'][hostKey].stubs && (_configJs2['default'][hostKey].stubs = _configJs2['default'][hostKey].stubs.map(_pathToRegexp2['default']));
	_configJs2['default'][hostKey].backed && (_configJs2['default'][hostKey].backed = _configJs2['default'][hostKey].backed.map(_pathToRegexp2['default']));
	_configJs2['default'][hostKey].tampered && (_configJs2['default'][hostKey].tampered = _configJs2['default'][hostKey].tampered.map(_pathToRegexp2['default']));
});

function hashParams(v) {
	if (!(v.length || Object.keys(v).length)) {
		return '';
	}
	return '-' + _crypto2['default'].createHash('md5').update(JSON.stringify(v)).digest('hex');
}

function getStubFileName(req) {
	return 'stubs/' + (req._parsedUrl.hostname || req._parsedUrl.host) + '/' + req.method.toLowerCase() + '-' + (req._parsedUrl.path !== '/' ? encodeURIComponent(req._parsedUrl.path.replace(/^\//, '')) : '_') + (req.params ? hashParams(req.params) : '');
}

function proxyMiddleware(req, res, next) {
	var options = arguments[3] === undefined ? {} : arguments[3];

	req.pause();
	var requestOptions = {
		hostname: req._parsedUrl.hostname || req._parsedUrl.host || req.headers.host,
		path: req._parsedUrl.path,
		method: req.method,
		headers: { 'X-Forwarded-For': req.connection.remoteAddress }
	},
	    removedHeaders = proxyRemovedHeaders.slice(),
	    removeHeadersExp,
	    port,
	    proxyReq,
	    cacheStream;
	options.isBacked && removedHeaders.push.apply(removedHeaders, proxyBackupRemovedHeaders);
	removeHeadersExp = new RegExp('^' + removedHeaders.join('|') + '$');
	Object.keys(req.headers).forEach(function (header) {
		header.match(removeHeadersExp) || (requestOptions.headers[header] = req.headers[header]);
	});

	if (req._parsedUrl.port) {
		port = req._parsedUrl.port;
	} else if (req.headers.origin) {
		req.headers.origin.replace(portExp, function (m, p) {
			return port = p;
		});
	}

	port && (requestOptions.port = port);

	verbose && console.log('proxying to %s(http://%s:%s%s)', requestOptions.method, requestOptions.hostname, requestOptions.port || 80, requestOptions.path);

	proxyReq = _http2['default'].request(requestOptions, function (proxyRes) {
		proxyRes.pause();
		Object.keys(proxyRes.headers).forEach(function (hname) {
			return res.removeHeader(hname);
		});
		res.setHeader('via', 'stuback');
		res.writeHead(proxyRes.statusCode, proxyRes.headers);
		if (options.isBacked) {
			(function () {
				var stubFileName = getStubFileName(req);
				var stubDirname = _path2['default'].dirname(stubFileName);
				_fs2['default'].existsSync(stubDirname) || _mkdirp2['default'].sync(stubDirname);
				cacheStream = _fs2['default'].createWriteStream(stubFileName);
				cacheStream.on('close', function () {
					verbose && console.log('backed in %s', stubFileName);
				});
				proxyRes.pipe(cacheStream);
			})();
		}
		proxyRes.pipe(res);
		proxyRes.resume();
	});

	proxyReq.on('error', function (err) {
		if (options.isBacked) {
			var _options = {
				isStubbed: true,
				isBacked: false,
				isTampered: false,
				passthrough: false
			};
			stubMiddleware(req, res, next, _options);
		} else {
			next(err);
		}
		console.log('errr', err);
	});

	res.on('finished', function () {
		// cacheStream.end();
		console.log('send response %s', res);
	});

	req.pipe(proxyReq);
	req.resume();
}

function stubMiddleware(req, res, next) {
	var options = arguments[3] === undefined ? {} : arguments[3];

	var stubFileName = getStubFileName(req);

	verbose && console.log('pattern searching for %s(%s)', req.method, req.path);

	_fs2['default'].exists(stubFileName, function (exists) {
		if (!exists) {
			verbose && console.log('patterns didn\'t found response for %s(%s) -> (%s)', req.method, req.url, _path2['default'].basename(stubFileName));
			if (options.passthrough) {
				return proxyMiddleware(req, res, next, options);
			}
			return next();
		}
		console.log('Reply with get/%s', _path2['default'].basename(stubFileName));
		var stub = _fs2['default'].createReadStream(stubFileName);
		stub.pipe(res);
	});
}

var app = (0, _connect2['default'])();
// var tlsOptions = {
// 	key:    fs.readFileSync(__dirname + '/../key.pem'),
// 	cert:   fs.readFileSync(__dirname + '/../cert.pem')
// };

// proxy auto config generation
app.use('/proxy.pac', function (req, res, next) {
	console.log('serving PAC for %s', req.connection.remoteAddress);
	var address = httpServer.address();
	var localAddress = (address.address.match(/^(|::)$/) ? '127.0.0.1' : address.address) + ':' + address.port;
	var pacConfig = Object.keys(_configJs2['default']).map(function (hostKey) {
		var direct = _configJs2['default'][hostKey].passthrough ? '; DIRECT' : '';
		return 'if (shExpMatch(host, \'' + hostKey + '\')) return \'PROXY ' + localAddress + '' + direct + '\';';
	}).join('\n\t');
	res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig');
	res.end('function FindProxyForURL(url, host) {\n\t' + pacConfig + '\n\treturn "DIRECT";\n}');
});

// do the real job
app.use(function (req, res, next) {
	console.log('request received', req.originalUrl);
	if (!_configJs2['default'][req._parsedUrl.hostname]) {
		console.log('proxying call to %s', req._parsedUrl.hostname);
		return proxyMiddleware(req, res, next);
	}

	var hostConfig = _configJs2['default'][req._parsedUrl.hostname],
	    url = req._parsedUrl.path,
	    middleWareOptions = {
		isStubbed: hostConfig.stubs.some(function (exp) {
			return !!url.match(exp);
		}),
		isBacked: hostConfig.backed.some(function (exp) {
			return !!url.match(exp);
		}),
		isTampered: hostConfig.tampered.some(function (exp) {
			return !!url.match(exp);
		}),
		passthrough: !!hostConfig.passthrough
	};

	if (middleWareOptions.isStubbed) {
		stubMiddleware(req, res, next, middleWareOptions);
	} else if (middleWareOptions.isBacked) {
		proxyMiddleware(req, res, next, middleWareOptions);
	} else if (middleWareOptions.passthrough) {
		proxyMiddleware(req, res, next);
	} else {
		next();
	}
});

var httpServer = _http2['default'].createServer(app).listen(serverHttpPort);
// https.createServer(tlsOptions, app).listen(3001);
console.log('Stuback listening on port ' + serverHttpPort + '\nYou can use Automatic proxy configuration at http://localhost:' + serverHttpPort + '/proxy.pac\n');
