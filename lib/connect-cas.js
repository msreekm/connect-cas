/*global require process console JSON __dirname */
var parseUrl = require('url').parse
var formatUrl = require('url').format
var http = require('http')
var querystring = require('querystring')
var _ = require('underscore')

// defaults
var defaults = {
    protocol: 'https',
    host: undefined,
    hostname: undefined, // ex. google
    port: 443,
    gateway: false, // set to true if you wish to do authentication instead of authorization
    paths: {
        validate: '/cas/validate',               // not implemented
        serviceValidate: '/cas/serviceValidate', // CAS 2.0
        proxyValidate: '/cas/proxyValidate',     // not implemented
        proxy: '/cas/proxy',                     // not implemented
        login: '/cas/login',
        logout: '/cas/logout'
    }
}

function configure(options) {
    defaults = _.extend(defaults, options);
}

function ssout(options){
    options = _.extend(defaults, options);
    return function(req,res,next){
        var method = req.method.toLowerCase();
        if (method === 'post'){
            var body = '';
            req.on('data', function(chunk){
                body += chunk;
            });
            req.on('end', function(){
                if(/<samlp:SessionIndex>(.*)<\/samlp:SessionIndex>/.exec(body)){
                    var st = RegExp.$1;
                    req.session.destroy(function(err){
                        if (err) console.error(err);

                        res.writeHead(204);
                        res.end();
                    });
                } else{
                    next();
                }
            });
        } else {
            next();
        }
    }
}

function ticket(options) {
    var options = _.extend(defaults, options);
    if (!options.host && !options.hostname) throw new Error('no CAS host specified');

    return function(req,res,next){
        var url = parseUrl(req.url, true);
        var ticket = (url.query && url.query.ticket) ? url.query.ticket : undefined;

        if (ticket) {
            var service = determine_service(req)

            var validateUri = formatUrl(options) + options.paths.serviceValidate + '?' + querystring.stringify({service:service, ticket: ticket});
            validateTicket(validateUri, req, res, function(body, success){
                if (success) {
                    req.session.st = ticket;
                    // valid user
                    if(/<cas:user>(\w+)<\/cas:user>/.exec(body)){
                        req.session.name = RegExp.$1;
                    }
                    res.writeHead(303, {location: service});
                    res.end();

                } else {
                    if (req.session.st) {
                        res.writeHead(303, {location: service});
                        res.end();
                    } else {
                        res.writeHead(307, {location: formatUrl(options) + options.paths.login + '?' + querystring.stringify({service: service})}); // this shoudl be the stripped params redir
                        res.end();
                    }
                }
            });
        } else {
            if (options.gateway){
                if (req.session.gateway) {
                    next();
                } else {
                    req.session.gateway = true;
                    res.writeHead(307, {location: formatUrl(options) + options.paths.login + '?' + querystring.stringify({service: determine_service(req), gateway: true})});
                    res.end();
                }
                return;
            }

            if (req.session.st) {
                next();
            } else {
                res.writeHead(307, {location: formatUrl(options) + options.paths.login + '?' + querystring.stringify({service: determine_service(req)})});
                res.end();
            }
        }
    }
}

function determine_service(req){
    var url = parseUrl(req.url, true);
    url.protocol = url.protocol || 'http'; // todo: the default should be more intelligent
    url.host = req.headers.host;
    return url.protocol+'://'+url.host+url.pathname
}
function validateTicket(validateUri, req, res, callback){
    http.get(validateUri, function (response) {
        if (response.statusCode !== 200) {
            res.writeHead(403) 
            res.end();
        }
        var body = '';
        response.on('data', function(chunk){
            body += chunk;
        });
        response.on('end', function(){
            if (/cas:authenticationSuccess/.exec(body)){
                callback(body, true);
            } else {
                callback(body, false);
            }
        });
    }).on('error', function(e) {
        res.writeHead(403); 
        res.end();
    });
}
exports.configure = configure;
exports.ticket = ticket;
exports.ssout = ssout;