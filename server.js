const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/ping', (req, res) => {
    res.send('pong');
});

app.use(express.static('public'));

// Хранилища
const users = new Map();          // socketId -> username
const messages = new Map();       // key = "user1:user2" -> array
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Загружаем сообщения из файла
function loadMessages() {
    try {
        if (fs.existsSync(MESSAGES_FILE)) {
            const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [key, value] of Object.entries(loaded)) {
                messages.set(key, value);
            }
            console.log('Messages loaded from file');
        }
    } catch (err) {
        console.error('Error loading messages:', err);
    }
}

// Сохраняем сообщения в файл
function saveMessages() {
    const obj = Object.fromEntries(messages);
    fs.writeFile(MESSAGES_FILE, JSON.stringify(obj, null, 2), err => {
        if (err) console.error('Error saving messages:', err);
    });
}

loadMessages();

function getDialogKey(u1, u2) {
    const [a, b] = [u1, u2].sort();
    return `${a}:${b}`;
}

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('register', ({ username }, callback) => {
        // Проверка уникальности имени среди активных
        let isUnique = true;
        for (let [id, u] of users.entries()) {
            if (u === username && id !== socket.id) {
                isUnique = false;
                break;
            }
        }
        if (!isUnique) {
            callback({ success: false, error: 'Имя уже занято' });
            return;
        }

        users.set(socket.id, username);
        socket.username = username;

        // Отправляем текущему пользователю список онлайн-пользователей
        const userList = Array.from(users.values()).map(u => ({ username: u }));
        socket.emit('user list', userList);

        // Оповещаем всех о новом пользователе
        socket.broadcast.emit('user joined', { username });

        callback({ success: true, username });
    });

    socket.on('get users', () => {
        const userList = Array.from(users.values()).map(u => ({ username: u }));
        socket.emit('user list', userList);
    });

    socket.on('get history', (targetUsername) => {
        const current = socket.username;
        if (!current) return;
        const key = getDialogKey(current, targetUsername);
        const history = messages.get(key) || [];
        socket.emit('chat history', { target: targetUsername, messages: history });
    });

    socket.on('private message', ({ to, text }) => {
        const from = socket.username;
        if (!from || !to || !text) return;

        const message = {
            id: Date.now() + Math.random(),
            from,
            to,
            text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };

        const key = getDialogKey(from, to);
        if (!messages.has(key)) messages.set(key, []);
        const dialog = messages.get(key);
        dialog.push(message);
        if (dialog.length > 200) dialog.shift();

        // Сохраняем в файл
        saveMessages();

        // Отправляем отправителю
        socket.emit('private message', message);

        // Отправляем получателю, если онлайн
        let recipientId = null;
        for (let [id, u] of users.entries()) {
            if (u === to) {
                recipientId = id;
                break;
            }
        }
        if (recipientId) {
            io.to(recipientId).emit('private message', message);
        }
    });

    socket.on('disconnect', () => {
        const username = users.get(socket.id);
        if (username) {
            users.delete(socket.id);
            io.emit('user left', username);
            console.log(`User ${username} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));