# express-kotoumi

  express-kotoumi provides a framework for building scalable
  realtime web API services for Express.

# usage

## server

If both express-kotoumi and kotoumi (fluentd) are running on the same machine,
you can initialize the express-kotoumi instance easily.

    var express = require('express'),
        kotoumi = require('express-kotoumi');
    
    var application = express();
    var server = require('http').createServer(application);
    server.listen(80); // the port to communicate with clients
    
    application.kotoumi({
      prefix: '/kotoumi',
      tag:    'kotoumi',
      server: server, // this is required to initialize Socket.IO API!
      extraCommands: [ // optional
        // extra command will be sent to kotoumi via the Socket.IO API, as is.
        'kotoumi.reindex'
      ]
    });

Otherwise, you have to specify pairs of host and port to send messages
to the kotoumi and to receive messages from the kotoumi.

    application.kotoumi({
      prefix: '/kotoumi',
      tag:    'kotoumi',
      server: server,
      extraCommands: [
        'kotoumi.reindex'
      ],
    
      // host and port to send messages to kotoumi
      hostName: 'backend.kotoumi.example.org',
      port:     24224,

      // host and port to receive messages from kotoumi
      receiveHostName: 'express.kotoumi.example.org',
      receivePort:     10030
    });


## client (REST)

Frontend applications can call REST APIs to access resources stored in
the kotoumi. For example:

    GET /kotoumi/tables/entries?query=foobar HTTP/1.1

It works as a search request, and a JSON string will be returned as the result.

## client (Socket.IO)

Frontend applications can call raw APIs via Socket.IO. For example:

    var socket = io.connect('http://example.com:80');
    socket.on('search.result', function(data) {
      var records = data.body.records;
      ...
    });
    socket.emit('search', { query: 'foobar' });

In Socket.IO APIs, you'll send requests and receive results separately.
