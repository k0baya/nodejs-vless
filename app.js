const net = require('net');
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const auth = require("basic-auth");

const username = process.env.WEB_USERNAME || "admin";
const password = process.env.WEB_PASSWORD || "password";

const logcb = (...args) => console.log.bind(console, new Date().toISOString(), ...args);
const errcb = (...args) => console.error.bind(console, new Date().toISOString(), ...args);

const uuid = (process.env.UUID || '37a0bd7c-8b9f-4693-8916-bd1e2da0a817').replace(/-/g, '');
const port = process.env.PORT || 3000;

const app = express();

const server = http.createServer(app);

const wss = new WebSocket.Server({ server }, logcb('WebSocket server is listening on port:', port));

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    const clientPort = req.socket.remotePort;
    logcb('New connection established from', `${clientIP}:${clientPort}`)();

    ws.once('message', (msg) => {
        let i = msg.readUInt8(17) + 19;
        const targetPort = msg.readUInt16BE(i);
        i += 2;

        const ATYP = msg.slice(i, i += 1).readUInt8();
        const host = ATYP === 1 ? msg.slice(i, i += 4).join('.') : // IPv4
            (ATYP === 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) : // Domain
                (ATYP === 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : '')); // IPv6

        logcb('Resolved target', `Host: ${host}, Port: ${targetPort}`)();

        ws.send(Buffer.from([msg[0], 0]));

        const duplex = WebSocket.createWebSocketStream(ws);

        const socket = net.connect({ host, port: targetPort }, function () {
            logcb('Connected to target', `Host: ${host}, Port: ${targetPort}`)();
            this.write(msg.slice(i));

            duplex.on('error', errcb('Duplex Stream Error:'))
                .pipe(this)
                .on('error', errcb('Target Socket Error:'))
                .pipe(duplex);
        });

        socket.on('error', errcb('Connection Error:', { host, port: targetPort }));
    }).on('error', errcb('WebSocket Error:'));

    ws.on('close', logcb('Connection closed with', `${clientIP}:${clientPort}`));
});

app.use((req, res, next) => {
  const user = auth(req);
  if (user && user.name === username && user.pass === password) {
    return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Node"');
  return res.status(401).send();
});

app.get('*', (req, res) => {
    const protocol = req.protocol;
    let host = req.get('host');
    let port = protocol === 'https' ? 443 : 80;
    let path = req.path;
    
    if (host.includes(':')) {
        [host, port] = host.split(':');
    }

    const link = protocol === 'https' ?
        `vless://${uuid}@${host}:${port}?path=${path}&security=tls&encryption=none&host=${host}&type=ws&sni=${host}#node-vless` :
        `vless://${uuid}@${host}:${port}?type=ws&encryption=none&flow=&host=${host}&path=${path}#node-vless`;

    res.send(`<html><body><pre>${link}</pre></body></html>`);
});

server.listen(port, () => {
    logcb('Server is listening on port:', port)();
});
