var weechat = require('weechat'),
    mongoose = require('mongoose'),
    config = require('../config');

// establish models
var User = mongoose.model('User');
var Connection = mongoose.model('Connection');
var Message = mongoose.model('Message');

// Constructor
var IRCLink = function(hostname, port, ssl, selfSigned, nick, realName, password, rejoin, away, encoding, keepAlive, channels) {
        this.sockets = new Array();
        this.server = hostname;

        if (away === undefined || away == '') this.away = 'AFK';
        else this.away = away;

        var pPort = parseInt(port);
        if (!pPort) pPort = (ssl ? 6697 : 6667);

        if (channels === undefined || !rejoin) var channels = new Array();

        var emit = function(event, args) {
                for (var i = 0; i < instance.sockets.length; i++) {
                    instance.sockets[i].emit(event, args);
                }
            };
        var on = function(name, event) {
                for (var i = 0; i < instance.sockets.length; i++) {
                    instance.sockets[i].on(name, event);
                }
            };

        console.log('Connecting: ', hostname, pPort, password);
        this.client = new weechat();
        this.client.on('error', function(err) {
            console.error(err);
        });
        this.client.on('open', function(buffers) {
            console.log('open');
            buffers.forEach(function(buffer) {
                if (buffer && buffer.pointers) {
                    buffer.id = buffer.pointers[0];
                    emit('buffer', buffer);
                } else {
                    console.error('Buffer has no pointers: ', buffer);
                }
            });
        });

        this.client.on('close', function(buffers) {
            console.log('close');
            buffers.forEach(function(buffer) {
                emit('closeBuffer', buffer.buffer);
            });
        });

        this.client.on('line', function(lines) {
            console.log('line');
            lines.forEach(function(line) {
                emit('auth', {
                    bufferid: line.buffer,
                    from: line.prefix,
                    date: line.date,
                    message: line.message
                });
            });
        });
        this.client.connect(hostname, pPort, password, function() {
            instance.client.bufferlines(30, function(buffers) {
                var restore = {
                    nick: 'eirikb1',
                    server: 'irc.homelien.no',
                    channels: buffers.map(function(buffer) {
                        return {
                            serverName: buffer.channel || buffer.name,
                            topic: buffer.title,
                            users: []
                        };
                    })
                };

                emit('restore_connection', restore);
            });

            on('getOldMessages', function(data) {
                instance.client.bufferlines(data.amount, function(buffers) {
                    var buffer = buffers.filter(function(b) {
                        var c = b.channel || b.name;
                        return c === data.channelName;
                    })[0];
                    if (buffer) {
                       emit('oldMessages', {
                           name: buffer.channel || buffer.name,
                           messages: buffer.lines.map(function(line) {
                               line.date = new Date(line.date * 1000);
                               line.user = line.prefix;
                               return line;
                           })
                       });
                    }
                });
            });
        });

        this.keepAlive = keepAlive;

        // Events to signal TO the front-end
        this.events = {
            'join': ['channel', 'nick'],
            'part': ['channel', 'nick'],
            'quit': ['nick', 'reason', 'channels', 'message'],
            'topic': ['channel', 'topic', 'nick'],
            'nick': ['oldNick', 'newNick', 'channels'],
            'names': ['channel', 'nicks'],
            'message': ['from', 'to', 'text'],
            '+mode': ['channel', 'by', 'mode', 'argument', 'message'],
            '-mode': ['channel', 'by', 'mode', 'argument', 'message'],
            'notice': ['nick', 'to', 'text', 'message'],
            'pm': ['nick', 'text'],
            'registered': ['message'],
            'motd': ['motd'],
            'whois': ['info'],
            'error': ['message'],
            'netError': ['message']
        };

        // store the instance
        var instance = this;

        // Add a listener on client for the given event & argument names
        this.activateListener = function(event, argNames) {
            instance.client.on(event, function() {
                console.log('Event called', arguments);
                // Associate specified names with callback arguments
                var callbackArgs = arguments;
                var args = {};
                argNames.forEach(function(arg, index) {
                    args[arg] = callbackArgs[index];
                });

                // loop through all sockets and emit events
                for (var i = 0; i < instance.sockets.length; i++) {
                    instance.sockets[i].emit(event, args);
                }

                // This is the logic on what to do on a recieved message
                if (event == 'message') {
                    if (instance.username) {
                        var target;
                        if (args.to[0] != '#') target = args.from.toLowerCase();
                        else target = args.to.toLowerCase();

                        // log this message
                        instance.logMessage(target, args.from, args.text);

                        if (instance.sockets.length == 0) {
                            instance.client.chans[target].unread_messages++;

                            var re = new RegExp('\\b' + nick.toLowerCase() + '\\b', 'g');
                            if (re.test(args.text.toLowerCase())) {
                                instance.client.chans[target].unread_mentions++;
                            }
                        }
                    }
                }

                // This is the logic to assign a user to log messages on join
                if (event == 'join') {
                    var target = args.channel.toLowerCase();

                    if (instance.client.chans[target] === undefined) instance.client.chans[target] = {
                        serverName: target,
                        unread_messages: 0,
                        unread_mentions: 0
                    };

                    if (instance.username && rejoin) {
                        // update the user's channel list
                        Connection.update({
                            user: instance.username
                        }, {
                            $addToSet: {
                                channels: target
                            }
                        }, function(err) {});
                    }
                }
            });
        };

        for (var event in this.events) {
            this.activateListener(event, this.events[event]);
        }
    }

    // properties and methods
    IRCLink.prototype = {
        associateUser: function(username) {
            this.username = username;
        },
        clearUnreads: function() {
            for (key in this.client.chans) {
                if (this.client.chans.hasOwnProperty(key)) {
                    var channel = this.client.chans[key];
                    channel.unread_messages = 0;
                    channel.unread_mentions = 0;
                }
            }
        },
        connect: function() {
            this.client.connect();
        },
        disconnect: function() {
            this.client.disconnect();
        },
        setAway: function() {
            this.client.write('AWAY', this.away);
        },
        addSocket: function(socket) {
            // set ourselves as not being away
            if (this.sockets.length == 0) this.client.write('AWAY', '');

            this.sockets.push(socket);
        },
        removeSocket: function(socket) {
            var index = this.sockets.indexOf(socket);
            if (index != -1) this.sockets.splice(index, 1);

            // set ourselves as away
            if (this.sockets.length == 0) this.client.write('AWAY', this.away);
        },
        logMessage: function(target, from, msg) {
            if (this.username) {
                var message = new Message({
                    channel: target.toLowerCase(),
                    server: this.server.toLowerCase(),
                    linkedto: this.username,
                    user: from,
                    message: msg
                });
                message.save();

                // keep log size in check
                Message.count({}, function(err, count) {
                    if (count > config.misc.max_log_size) {
                        var query = Message.find({});

                        query.limit(count - config.misc.max_log_size);
                        query.sort('date', 1);

                        query.exec(function(err, records) {
                            records.forEach(function(record) {
                                record.remove();
                            });
                        });
                    }
                });
            }
        }
    };

// node.js module export
module.exports = IRCLink;
