const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Хранилище активных пользователей: socketId -> username
const users = new Map();
// Хранилище сообщений: ключ "user1:user2" -> массив сообщений
let messages = new Map();

// Загрузка истории из файла (если есть)
const HISTORY_FILE = path.join(__dirname, 'messages.json');
if (fs.existsSync(HISTORY_FILE)) {
    try {
        const data = fs.readFileSync(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        messages = new Map(Object.entries(parsed));
    } catch(e) { console.error('Ошибка загрузки истории:', e); }
}

// Функция сохранения истории в файл
function saveHistory() {
    const obj = Object.fromEntries(messages);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(obj, null, 2));
}

function getDialogKey(user1, user2) {
    const [a, b] = [user1, user2].sort();
    return `${a}:${b}`;
}

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Регистрация
    socket.on('register', (username, callback) => {
        // Проверка уникальности имени
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

        // Отправляем список активных пользователей (без себя)
        const activeUsers = Array.from(users.values()).filter(u => u !== username);
        socket.emit('user list', activeUsers);

        // Оповещаем всех остальных о новом пользователе
        socket.broadcast.emit('user joined', username);

        callback({ success: true, username });
    });

    // Получение списка активных пользователей
    socket.on('get users', () => {
        const activeUsers = Array.from(users.values()).filter(u => u !== socket.username);
        socket.emit('user list', activeUsers);
    });

    // Запрос истории сообщений с конкретным пользователем
    socket.on('get history', (targetUsername) => {
        const current = socket.username;
        if (!current) return;
        const key = getDialogKey(current, targetUsername);
        const history = messages.get(key) || [];
        socket.emit('chat history', { target: targetUsername, messages: history });
    });

    // Отправка текстового сообщения
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
        saveHistory();

        // Отправить отправителю
        socket.emit('private message', message);

        // Найти получателя и отправить ему
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

    // Отключение пользователя
    socket.on('disconnect', () => {
        const username = users.get(socket.id);
        if (username) {
            users.delete(socket.id);
            socket.broadcast.emit('user left', username);
            console.log(`User ${username} disconnected`);
        }
    });
});

// ЕДИНСТВЕННОЕ объявление PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});