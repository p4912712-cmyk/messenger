const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/ping', (req, res) => {
    res.send('pong');
});

app.use(express.static('public'));

// Простой массив для хранения сообщений (все видят)
let messages = [];

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('chat history', messages);

    socket.on('chat message', (msg) => {
        console.log('Message:', msg);
        messages.push(msg);
        if (messages.length > 100) messages.shift();
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// ОБЯЗАТЕЛЬНО используем порт из окружения
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});