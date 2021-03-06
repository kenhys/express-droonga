var assert = require('chai').assert;
var nodemock = require('nodemock');
var Deferred = require('jsdeferred').Deferred;
var express = require('express');

var utils = require('../test-utils');

var socketIoAdapter = require('../../lib/adapter/socket.io');
var command = require('../../lib/adapter/command');
var api = require('../../lib/adapter/api');
var scoketIoAPI = require('../../lib/adapter/api/socket.io');

suite('Socket.IO Adapter', function() {
  var connection;
  var server;
  var clientSockets;
  var backend;

  var testPlugin = {
    'reqrep': new command.SocketRequestResponse(),
    'reqrep-mod-event': new command.SocketRequestResponse({
      onRequest: function(data, connection) {
        connection.emit('reqrep-mod-event.mod', data);
      },
      onResponse: function(data, socket) {
        socket.emit('reqrep-mod-event.response.mod', data);
      }
    }),
    'reqrep-mod-body': new command.SocketRequestResponse({
      onRequest: function(data, connection) {
        connection.emit('reqrep-mod-body', 'modified request');
      },
      onResponse: function(data, socket) {
        socket.emit('reqrep-mod-body.response', 'modified response');
      }
    }),
    'pubsub': new command.SocketPublishSubscribe(),
    'pubsub-mod-event': new command.SocketPublishSubscribe({
      onSubscribe: function(data, connection) {
        connection.emit('pubsub-mod-event.mod.subscribe', data);
      },
      onSubscribed: function(data, socket) {
        socket.emit('pubsub-mod-event.mod.subscribe.response', data);
      },
      onUnsubscribe: function(data, connection) {
        connection.emit('pubsub-mod-event.mod.unsubscribe', data);
      },
      onUnsubscribed: function(data, socket) {
        socket.emit('pubsub-mod-event.mod.unsubscribe.response', data);
      },
      onNotify: function(data, socket) {
        socket.emit('pubsub-mod-event.mod.notification', data);
      }
    }),
    'pubsub-mod-body': new command.SocketPublishSubscribe({
      onSubscribe: function(data, connection) {
        connection.emit('pubsub-mod-body.subscribe', 'modified request');
      },
      onSubscribed: function(data, socket) {
        socket.emit('pubsub-mod-body.subscribe.response', 'modified response');
      },
      onUnsubscribe: function(data, connection) {
        connection.emit('pubsub-mod-body.unsubscribe', 'modified request');
      },
      onUnsubscribed: function(data, socket) {
        socket.emit('pubsub-mod-body.unsubscribe.response', 'modified response');
      },
      onNotify: function(data, socket) {
        socket.emit('pubsub-mod-body.notification', 'modified response');
      }
    })
  };

  setup(function() {
    clientSockets = [];
  });

  teardown(function() {
    if (clientSockets.length) {
      clientSockets.forEach(function(clientSocket) {
        clientSocket.disconnect();
      });
    }
    utils.teardownApplication({ backend:    backend,
                                server:     server,
                                connection: connection });
  });

  test('registration of plugin commands', function(done) {
    var basePlugin = {
      getCommand: new command.SocketRequestResponse(),
      putCommand: new command.SocketRequestResponse(),
      postCommand: new command.SocketRequestResponse(),
      deleteCommand: new command.SocketRequestResponse(),
      ignored: new command.HTTPCommand()
    };
    var overridingPlugin = {
      postCommand: new command.SocketRequestResponse(),
      deleteCommand: new command.SocketRequestResponse()
    };

    var application = express();
    utils.setupServer(application)
      .next(function(newServer) {
        server = newServer;

        var registeredCommands = socketIoAdapter.register(application, server, {
          connection: utils.createStubbedBackendConnection(),
          plugins: [
            api.API_REST,
            api.API_SOCKET_IO,
            api.API_GROONGA,
            api.API_DROONGA,
            basePlugin,
            overridingPlugin
          ]
        });

        registeredCommands = registeredCommands.map(function(command) {
          return {
            name:       command.name,
            definition: command.definition
          };
        });
        assert.deepEqual(registeredCommands,
                         [{ name:       'search',
                            definition: scoketIoAPI.search },
                          { name:       'watch',
                            definition: scoketIoAPI.watch },
                          { name:       'getCommand',
                            definition: basePlugin.getCommand },
                          { name:       'putCommand',
                            definition: basePlugin.putCommand },
                          { name:       'postCommand',
                            definition: overridingPlugin.postCommand },
                          { name:       'deleteCommand',
                            definition: overridingPlugin.deleteCommand }]);
        done();
      })
      .error(function(error) {
        done(error);
      });
  });

  test('initialization', function(done) {
    var mockedListener = nodemock
      .mock('connected');

    var application = express();
    application.on('connection', function(socket) {
      mockedListener.connected();
    });

    utils.setupServer(application)
      .next(function(newServer) {
        server = newServer;
        socketIoAdapter.register(application, server, {
          connection: utils.createStubbedBackendConnection(),
          plugins: [
            api.API_REST,
            api.API_SOCKET_IO,
            api.API_GROONGA,
            api.API_DROONGA,
            testPlugin
          ]
        });

        return utils.createClientSocket();
      })
      .next(function(newClientSocket) {
        clientSockets.push(newClientSocket);
      })
      .wait(0.01)
      .next(function() {
        mockedListener.assertThrows();
        done();
      })
      .error(function(error) {
        done(error);
      });
  });

  function testReqRep(test, description, params) {
    test(description, function(done) {
      var mockedReceiver;
      utils.setupApplication()
        .next(function(result) {
          server     = result.server;
          connection = result.connection;
          backend    = result.backend;
          socketIoAdapter.register(result.application, server, {
            tag:      utils.testTag,
            connection: connection,
            plugins: [
              api.API_REST,
              api.API_SOCKET_IO,
              api.API_GROONGA,
              api.API_DROONGA,
              testPlugin
            ]
          });
        })
        .createClientSocket()
        .next(function(newClientSocket) {
          clientSockets.push(newClientSocket);
          clientSockets[0].emit(params.clientCommand, params.clientBody);
        })
        .wait(0.01)
        .next(function() {
          backend.assertReceived([{ type: params.expectedClientCommand,
                                    body: params.expectedClientBody }]);

          mockedReceiver = nodemock
            .mock('receive')
              .takes(params.expectedBackendBody);
          clientSockets[0].on(params.expectedBackendCommand, function(data) {
            mockedReceiver.receive(data);
          });

          return backend.sendResponse(backend.getMessages()[0],
                                      params.backendCommand,
                                      params.backendBody);
        })
        .wait(0.01)
        .next(function() {
          mockedReceiver.assertThrows();
          done();
        })
        .error(function(error) {
          done(error);
        });
    });
  }

  suite('request-response', function() {
    testReqRep(test, 'basic', {
      clientCommand:          'reqrep',
      clientBody:             'raw request',
      expectedClientCommand:  'reqrep',
      expectedClientBody:     'raw request',
      backendCommand:         'reqrep.response',
      backendBody:            'raw response',
      expectedBackendCommand: 'reqrep.response',
      expectedBackendBody:    'raw response'        
    });

    testReqRep(test, 'modified event type', {
      clientCommand:          'reqrep-mod-event',
      clientBody:             'raw request',
      expectedClientCommand:  'reqrep-mod-event.mod',
      expectedClientBody:     'raw request',
      backendCommand:         'reqrep-mod-event.response',
      backendBody:            'raw response',
      expectedBackendCommand: 'reqrep-mod-event.response.mod',
      expectedBackendBody:    'raw response'        
    });

    testReqRep(test, 'modified body', {
      clientCommand:          'reqrep-mod-body',
      clientBody:             'raw request',
      expectedClientCommand:  'reqrep-mod-body',
      expectedClientBody:     'modified request',
      backendCommand:         'reqrep-mod-body.response',
      backendBody:            'raw response',
      expectedBackendCommand: 'reqrep-mod-body.response',
      expectedBackendBody:    'modified response'        
    });

    test('multiple clients', function(done) {
      var messages = [
        '0-a',
        '1-a',
        '2-a',
        '0-b',
        '1-b',
        '2-b'
      ];
      var clientReceiver;
      utils.setupApplication()
        .next(function(result) {
          server     = result.server;
          connection = result.connection;
          backend    = result.backend;
          socketIoAdapter.register(result.application, server, {
            tag:      utils.testTag,
            connection: connection,
            plugins: [
              api.API_REST,
              api.API_SOCKET_IO,
              api.API_GROONGA,
              api.API_DROONGA,
              testPlugin
            ]
          });
        })
        .createClientSockets(3)
        .next(function(newClientSockets) {
          clientSockets = clientSockets.concat(newClientSockets);
          clientSockets[0].emit('reqrep', messages[0]);
        }).wait(0.01).next(function() {
          clientSockets[1].emit('reqrep', messages[1]);
        }).wait(0.01).next(function() {
          clientSockets[2].emit('reqrep', messages[2]);
        }).wait(0.01).next(function() {
          clientSockets[0].emit('reqrep', messages[3]);
        }).wait(0.01).next(function() {
          clientSockets[1].emit('reqrep', messages[4]);
        }).wait(0.01).next(function() {
          clientSockets[2].emit('reqrep', messages[5]);
        }).wait(0.01).next(function() {
          assert.deepEqual(backend.getBodies(), messages);

          var responses = backend.getMessages().map(function(envelope) {
            return utils.createReplyEnvelope(envelope, 'reqrep', envelope.body);
          });

          clientReceiver = nodemock
            .mock('receive').takes('0:' + messages[0])
            .mock('receive').takes('1:' + messages[1])
            .mock('receive').takes('2:' + messages[2])
            .mock('receive').takes('0:' + messages[3])
            .mock('receive').takes('1:' + messages[4])
            .mock('receive').takes('2:' + messages[5]);
          clientSockets[0].on('reqrep', function(data) {
            clientReceiver.receive('0:' + data);
          });
          clientSockets[1].on('reqrep', function(data) {
            clientReceiver.receive('1:' + data);
          });
          clientSockets[2].on('reqrep', function(data) {
            clientReceiver.receive('2:' + data);
          });

          return utils
            .sendPacketTo(utils.createPacket(responses[0]), utils.testReceivePort)
            .wait(0.01)
            .sendPacketTo(utils.createPacket(responses[1]), utils.testReceivePort)
            .wait(0.01)
            .sendPacketTo(utils.createPacket(responses[2]), utils.testReceivePort)
            .wait(0.01)
            .sendPacketTo(utils.createPacket(responses[3]), utils.testReceivePort)
            .wait(0.01)
            .sendPacketTo(utils.createPacket(responses[4]), utils.testReceivePort)
            .wait(0.01)
            .sendPacketTo(utils.createPacket(responses[5]), utils.testReceivePort);
        })
        .wait(0.01)
        .next(function() {
          clientReceiver.assertThrows();
          done();
        })
        .error(function(error) {
          done(error);
        });
    });

    test('event with options', function(done) {
      var clientReceiver;
      utils.setupApplication()
        .next(function(result) {
          server     = result.server;
          connection = result.connection;
          backend    = result.backend;
          socketIoAdapter.register(result.application, server, {
            tag:      utils.testTag,
            connection: connection,
            plugins: [
              api.API_REST,
              api.API_SOCKET_IO,
              api.API_GROONGA,
              api.API_DROONGA,
              testPlugin
            ]
          });
        })
        .createClientSockets(1)
        .next(function(newClientSockets) {
          clientSockets = clientSockets.concat(newClientSockets);
          clientSockets[0].emit('reqrep', 'message1',
                                { responseEvent: 'reqrep.extra.name' });
          clientSockets[0].emit('reqrep-mod-event', 'message2',
                                { responseEvent: 'reqrep-mod-event.extra.name' });
        }).wait(0.01).next(function() {
          assert.deepEqual(backend.getBodies(), ['message1', 'message2']);

          var responses = backend.getMessages().map(function(envelope) {
            return utils.createReplyEnvelope(envelope, envelope.type, envelope.body);
          });

          clientReceiver = nodemock
            .mock('receive').takes('message1')
            .mock('receive').takes('message2');
          clientSockets[0].on('reqrep.extra.name', function(data) {
            clientReceiver.receive(data);
          });
          clientSockets[0].on('reqrep-mod-event.extra.name', function(data) {
            clientReceiver.receive(data);
          });

          return utils
            .sendPacketTo(utils.createPacket(responses[0]), utils.testReceivePort)
            .next(function() {
              return utils
                .sendPacketTo(utils.createPacket(responses[1]), utils.testReceivePort)
            });
        })
        .wait(0.01)
        .next(function() {
          clientReceiver.assertThrows();
          done();
        })
        .error(function(error) {
          done(error);
        });
    });
  });

  suite('publish-subscribe', function() {
    testReqRep(test, 'basic', {
      clientCommand:          'pubsub.subscribe',
      clientBody:             'raw request',
      expectedClientCommand:  'pubsub.subscribe',
      expectedClientBody:     'raw request',
      backendCommand:         'pubsub.subscribe.response',
      backendBody:            'raw response',
      expectedBackendCommand: 'pubsub.subscribe.response',
      expectedBackendBody:    'raw response'        
    });

    testReqRep(test, 'modified event type', {
      clientCommand:          'pubsub-mod-event.subscribe',
      clientBody:             'raw request',
      expectedClientCommand:  'pubsub-mod-event.mod.subscribe',
      expectedClientBody:     'raw request',
      backendCommand:         'pubsub-mod-event.subscribe.response',
      backendBody:            'raw response',
      expectedBackendCommand: 'pubsub-mod-event.mod.subscribe.response',
      expectedBackendBody:    'raw response'        
    });

    testReqRep(test, 'modified body', {
      clientCommand:          'pubsub-mod-body.subscribe',
      clientBody:             'raw request',
      expectedClientCommand:  'pubsub-mod-body.subscribe',
      expectedClientBody:     'modified request',
      backendCommand:         'pubsub-mod-body.subscribe.response',
      backendBody:            'raw response',
      expectedBackendCommand: 'pubsub-mod-body.subscribe.response',
      expectedBackendBody:    'modified response'        
    });

    test('notification', function(done) {
      var mockedReceiver;
      // step 0: setup
      utils.setupApplication()
        .next(function(result) {
          server     = result.server;
          connection = result.connection;
          backend    = result.backend;
          socketIoAdapter.register(result.application, server, {
            tag:      utils.testTag,
            connection: connection,
            plugins: [
              api.API_REST,
              api.API_SOCKET_IO,
              api.API_GROONGA,
              api.API_DROONGA,
              testPlugin
            ]
          });
        })
        .createClientSocket()
        .next(function(newClientSocket) {
          clientSockets.push(newClientSocket);
          clientSockets[0].on('pubsub.subscribe.response', function(data) {
            mockedReceiver.receive(data);
          });
          clientSockets[0].on('pubsub.unsubscribe.response', function(data) {
            mockedReceiver.receive(data);
          });
          clientSockets[0].on('pubsub.notification', function(data) {
            mockedReceiver.receive(data);
          });

      // step 1: notifications before subscribing
          mockedReceiver = nodemock
            .mock('receive').takes('nothing');
          return backend.sendMessage('pubsub.notification',
                                     'never notified');
        })
        .wait(0.01)
        .next(function() {
          mockedReceiver.receive('nothing');
          mockedReceiver.assertThrows();

      // step 2: subscribe
          clientSockets[0].emit('pubsub.subscribe', 'subscribe!');
        })
        .wait(0.01)
        .next(function() {
          backend.assertReceived([{ type: 'pubsub.subscribe',
                                    body: 'subscribe!' }]);

          mockedReceiver = nodemock
            .mock('receive')
              .takes('subscribed!');
          return backend.sendResponse(backend.getMessages()[0],
                                      'pubsub.subscribe.response',
                                      'subscribed!');
        })
        .wait(0.01)
        .next(function() {
          mockedReceiver.assertThrows();

      // step 3: notifications while subscribing
          mockedReceiver = nodemock
            .mock('receive').takes('notified 1')
            .mock('receive').takes('notified 2')
            .mock('receive').takes('notified 3');
          return backend.sendMessage('pubsub.notification',
                                     'notified 1');
        })
        .next(function() {
          return backend.sendMessage('pubsub.notification',
                                     'notified 2');
        })
        .next(function() {
          return backend.sendMessage('pubsub.notification',
                                     'notified 3');
        })
        .wait(0.01)
        .next(function() {
          mockedReceiver.assertThrows();

      // step 4: unsubscribe
          backend.clearMessages();
          clientSockets[0].emit('pubsub.unsubscribe', 'unsubscribe!');
        })
        .wait(0.01)
        .next(function() {
          backend.assertReceived([{ type: 'pubsub.unsubscribe',
                                    body: 'unsubscribe!' }]);

          mockedReceiver = nodemock
            .mock('receive')
              .takes('unsubscribed!');
          return backend.sendResponse(backend.getMessages()[0],
                                      'pubsub.unsubscribe.response',
                                      'unsubscribed!');
        })
        .wait(0.01)
        .next(function() {
          mockedReceiver.assertThrows();

      // step 5: notifications after unsubscribing
          mockedReceiver = nodemock
            .mock('receive').takes('nothing');
          return backend.sendMessage('pubsub.notification',
                                     'never notified');
        })
        .wait(0.01)
        .next(function() {
          mockedReceiver.receive('nothing');
          mockedReceiver.assertThrows();

          done();
        })
        .error(function(error) {
          done(error);
        });
    });
  });
});

