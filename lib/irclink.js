var weechat = require('weechat');

function IRCLink(host, port, password) {
    var self = this;

    var sockets = new Array();

    port = parseInt(port);

    function emit(event, args) {
        sockets.forEach(function(socket) {
            socket.emit(event, args);
        });
    }

    function on(name, event) {
        sockets.forEach(function(socket) {
            socket.on(name, event);
        });
    }

    function text(line) {
        return client.style(line).map(function(part) {
            return part.text;
        }).join('');
    }

    var client = weechat.connect(host, port, password, function() {
        /*
        client.bufferlines(30, function(buffers) {
            var restore = {
                nick: 'eirikb1',
                server: 'irc.homelien.no',
                channels: buffers.map(function(buffer) {
                    return {
                        serverName: buffer.channel || buffer.name,
                        id: buffer.id,
                        topic: buffer.title,
                        users: []
                    };
                })
            };

            emit('restore_connection', restore);
        });
       */

        on('getOldMessages', function(data) {
            client.bufferlines(data.amount, function(buffers) {
                var buffer = buffers.filter(function(b) {
                    var c = b.channel || b.name;
                    return c === data.channelName;
                })[0];
                if (buffer) {
                    emit('oldMessages', {
                        name: buffer.channel || buffer.name,
                        messages: buffer.lines.map(function(line) {
                            return {
                                date: new Date(line.date * 1000),
                                user: text(line.prefix),
                                message: text(line.message)
                            };
                        }).reverse()
                    });
                }
            });
        });
    });

    client.nick = 'eirikb1';

    client.on('error', function(err) {
        console.error(err);
    });

    client.on('open', function(buffers) {
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

    client.on('close', function(buffers) {
        console.log('close');
        buffers.forEach(function(buffer) {
            emit('closeBuffer', buffer.buffer);
        });
    });

    client.on('line', function(lines) {
        lines.forEach(function(line) {
            emit('message', {
                to: line.buffer,
                date: new Date(line.date * 1000),
                from: text(line.prefix),
                text: text(line.message)
            });
        });
    });

    self.addSocket = function(socket) {
        sockets.push(socket);
    };

    self.removeSocket = function(socket) {
        var index = sockets.indexOf(socket);
        if (index != -1) sockets.splice(index, 1);
    };

    self.client = client;

    var dummy = function() {};
    self.associateUser = dummy;
    self.clearUnreads = dummy;
    self.connect = dummy;
    self.disconnect = dummy;
    self.setAway = dummy;
    self.logMessage = dummy;
}

module.exports = IRCLink;
