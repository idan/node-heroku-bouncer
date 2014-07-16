// jshint -W030

'use strict';

require('should');
require('./test-helper');

var Promise       = require('bluebird');
var request       = require('request');
var tough         = require('tough-cookie');
var createClient  = require('./helpers/create-client');
var herokuStubber = require('./helpers/heroku');
var get           = Promise.promisify(request.get);
var post          = Promise.promisify(request.post);
var client;

describe('bouncer', function() {
  afterEach(function() {
    return new Promise(function(resolve) {
      if (client.address()) {
        client.close(resolve);
      } else {
        resolve();
      }
    });
  });

  describe('when the user is not logged in', function() {
    context('and it is a non-JSON GET request', function() {
      it('redirects to /auth/heroku', function() {
        return withClient().spread(function(client, url) {
          return get(url, { followRedirect: false });
        }).spread(function(res) {
          res.headers.location.should.eql('/auth/heroku');
        });
      });
    });

    context('and it is a non-GET request', function() {
      it('returns a 401', function() {
        return withClient().spread(function(client, url) {
          return post(url);
        }).spread(function(res) {
          res.statusCode.should.eql(401);
        });
      });

      it('returns an unauthorized message', function() {
        return withClient().spread(function(client, url) {
          return post(url);
        }).spread(function(res, body) {
          JSON.parse(body).should.eql({ id: 'unauthorized', message: 'Please authenticate.' });
        });
      });
    });

    context('and it is a JSON request', function() {
      it('returns a 401', function() {
        return withClient().spread(function(client, url) {
          return get(url, { json: true });
        }).spread(function(res) {
          res.statusCode.should.eql(401);
        });
      });

      it('returns an unauthorized message', function() {
        return withClient().spread(function(client, url) {
          return get(url, { json: true });
        }).spread(function(res, body) {
          body.should.eql({ id: 'unauthorized', message: 'Please authenticate.' });
        });
      });
    });
  });

  context('when the user is logged in', function() {
    context('and sessionSyncNonce is set', function() {
      var clientOptions, jar;

      beforeEach(function() {
        clientOptions = { sessionSyncNonce: 'my_session_nonce' };

        var cookie = new tough.Cookie({
          key  : 'my_session_nonce',
          value: 'my_session_nonce_value'
        });

        jar = request.jar();
        return setCookie(jar, cookie);
      });

      it('adds a sessionSyncNonce to the session', function() {
        return authenticate(clientOptions, jar).spread(function(client, url) {
          return get(url + '/hello-world', { jar: jar });
        }).spread(function(res) {
          var session = JSON.parse(res.headers['x-session']);
          session.herokuBouncerSessionNonce.should.eql('my_session_nonce_value');
        });
      });

      context('and the sessionSyncNonce has changed', function() {
        var cookie;

        beforeEach(function() {
          cookie = new tough.Cookie({
            key  : 'my_session_nonce',
            value: 'my_new_session_nonce_value'
          });
        });

        it('clears the session', function() {
          return authenticate(clientOptions, jar).spread(function(client, url) {
            return setCookie(jar, cookie).then(function() {
              return get(url + '/hello-world', { jar: jar, followRedirect: false });
            }).then(function() {
              return get(url + '/ignore', { jar: jar });
            });
          }).spread(function(res) {
            var session = JSON.parse(res.headers['x-session']);
            session.should.eql({ redirectPath: '/hello-world' });
          });
        });

        context('and it is a non-JSON GET request', function() {
          it('redirects the user to reauthenticate', function() {
            return authenticate(clientOptions, jar).spread(function(client, url) {
              return setCookie(jar, cookie).then(function() {
                return get(url + '/hello-world', { jar: jar, followRedirect: false });
              });
            }).spread(function(res) {
              res.headers.location.should.eql('/auth/heroku');
            });
          });
        });

        context('and it is a non-GET request', function() {
          it('returns a 401', function() {
            return authenticate(clientOptions, jar).spread(function(client, url) {
              return setCookie(jar, cookie).then(function() {
                return post(url + '/hello-world', { jar: jar });
              });
            }).spread(function(res) {
              res.statusCode.should.eql(401);
            });
          });

          it('returns an unauthorized message', function() {
            return authenticate(clientOptions, jar).spread(function(client, url) {
              return setCookie(jar, cookie).then(function() {
                return post(url + '/hello-world', { jar: jar });
              });
            }).spread(function(res, body) {
              JSON.parse(body).should.eql({ id: 'unauthorized', message: 'Please authenticate.' });
            });
          });
        });

        context('and it is a JSON request', function() {
          it('returns a 401', function() {
            return authenticate(clientOptions, jar).spread(function(client, url) {
              return setCookie(jar, cookie).then(function() {
                return get(url + '/hello-world', { jar: jar, json: true });
              });
            }).spread(function(res) {
              res.statusCode.should.eql(401);
            });
          });

          it('returns an unauthorized message', function() {
            return authenticate(clientOptions, jar).spread(function(client, url) {
              return setCookie(jar, cookie).then(function() {
                return get(url + '/hello-world', { jar: jar, json: true });
              });
            }).spread(function(res, body) {
              body.should.eql({ id: 'unauthorized', message: 'Please authenticate.' });
            });
          });
        });
      });
    });

    context('and herokaiOnly is set to `false`', function() {
      it('performs the request like normal', function() {
        return itBehavesLikeANormalRequest({ herokaiOnly: false });
      });
    });

    context('and herokaiOnly is set to `true`', function() {
      var clientOptions;

      beforeEach(function() {
        clientOptions = { herokaiOnly: true };
      });

      context('and the user is a Herokai', function() {
        it('performs the request like normal', function() {
          herokuStubber.stubUser({ email: 'user@heroku.com' });
          return itBehavesLikeANormalRequest(clientOptions);
        });
      });

      context('and the user is not a Herokai', function() {
        context('and it is a non-JSON GET request', function() {
          it('redirects to the Heroku website', function() {
            return authenticate(clientOptions).spread(function(client, url, jar) {
              return get(url + '/hello-world', { jar: jar, followRedirect: false });
            }).spread(function(res) {
              res.headers.location.should.eql('https://www.heroku.com');
            });
          });
        });

        context('and it is a non-GET request', function() {
          it('returns a 401', function() {
            return authenticate(clientOptions).spread(function(client, url, jar) {
              return post(url, { jar: jar });
            }).spread(function(res) {
              res.statusCode.should.eql(401);
            });
          });

          it('returns a non-Herokai message', function() {
            return authenticate(clientOptions).spread(function(client, url, jar) {
              return post(url, { jar: jar });
            }).spread(function(res, body) {
              JSON.parse(body).should.eql({ id: 'unauthorized', message: 'This app is limited to Herokai only.' });
            });
          });
        });

        context('and it is a JSON request', function() {
          it('returns a 401', function() {
            return authenticate(clientOptions).spread(function(client, url, jar) {
              return get(url, { jar: jar, json: true });
            }).spread(function(res) {
              res.statusCode.should.eql(401);
            });
          });

          it('returns a non-Herokai message', function() {
            return authenticate(clientOptions).spread(function(client, url, jar) {
              return get(url, { jar: jar, json: true });
            }).spread(function(res, body) {
              body.should.eql({ id: 'unauthorized', message: 'This app is limited to Herokai only.' });
            });
          });
        });
      });
    });

    context('and herokaiOnly is a function', function() {
      var clientOptions;

      beforeEach(function() {
        clientOptions = { herokaiOnly: function(req, res) {
          res.end('You are not a Herokai.');
        } };
      });

      context('and the user is a Herokai', function() {
        it('performs the request like normal', function() {
          herokuStubber.stubUser({ email: 'user@heroku.com' });
          return itBehavesLikeANormalRequest(clientOptions);
        });
      });

      context('and the user is not a Herokai', function() {
        it('uses the custom request handler', function() {
          return authenticate(clientOptions).spread(function(client, url, jar) {
            return get(url, { jar: jar });
          }).spread(function(res, body) {
            body.should.eql('You are not a Herokai.');
          });
        });
      });
    });
  });

  describe('logging out', function() {
    it('redirects to the logout path', function() {
      return authenticate().spread(function(client, url, jar) {
        return get(url + '/auth/heroku/logout', { jar: jar, followRedirect: false });
      }).spread(function(res) {
        // `client` is set in the scope of this module :\
        res.headers.location.should.eql('http://localhost:' + client.serverPort + '/logout');
      });
    });

    it('clears the session', function() {
      return authenticate().spread(function(client, url, jar) {
        return get(url + '/auth/heroku/logout', { jar: jar, followRedirect: false }).then(function() {
          return get(url + '/ignore', { jar: jar });
        });
      }).spread(function(res) {
        var session = JSON.parse(res.headers['x-session']);
        session.should.eql({});
      });
    });
  });

  describe('ignored routes', function() {
    context('when there is no user logged in', function() {
      it('ignores the specified routes', function() {
        return withClient().spread(function(client, url) {
          return get(url + '/ignore', { followRedirect: false });
        }).spread(function(res) {
          res.statusCode.should.eql(200);
        });
      });
    });

    context('when there is a user logged in', function() {
      it('uses its normal middleware', function() {
        return authenticate().spread(function(client, url, jar) {
          return get(url + '/token', { jar: jar });
        }).spread(function(res, body) {
          body.should.not.be.empty;
        });
      });
    });
  });
});

function authenticate(clientOptions, jar) {
  return withClient(clientOptions).spread(function(client, url) {
    jar = jar || request.jar();

    return get(url, { jar: jar }).then(function() {
      return [client, url, jar];
    });
  });
}

function itBehavesLikeANormalRequest(clientOptions) {
  return authenticate(clientOptions).spread(function(client, url, jar) {
    return get(url + '/hello-world', { jar: jar });
  }).spread(function(res, body) {
    body.should.eql('hello world');
  });
}

function setCookie(jar, cookie) {
  return new Promise(function(resolve) {
    jar.setCookie(cookie, 'http://localhost', resolve);
  });
}

function withClient(options) {
  options = options || {};

  return createClient(options).spread(function(_client, url) {
    client = _client;
    return [client, url];
  });
}
