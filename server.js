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

// Файл для хранения сообщений
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Загружаем сохранённые сообщения при старте
let messages = new Map(); // ключ "user1:user2" -> массив сообщений
if (fs.existsSync(MESSAGES_FILE)) {
    try {
        const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
        const parsed = JSON.parse(data);
        messages = new Map(Object.entries(parsed));
    } catch (err) {
        console.error('Ошибка загрузки сообщений:', err);
    }
}

// Функция сохранения сообщений в файл
function saveMessages() {
    const obj = Object.fromEntries(messages);
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(obj, null, 2));
}

// Хранилище пользователей онлайн
const users = new Map(); // socketId -> { username }

function getDialogKey(u1, u2) {
    const [a, b] = [u1, u2].sort();
    return `${a}:${b}`;
}

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Регистрация
    socket.on('register', ({ username }, callback) => {
        // Проверка уникальности имени среди онлайн
        let isUnique = true;
        for (let [id, u] of users.entries()) {
            if (u.username === username && id !== socket.id) {
                isUnique = false;
                break;
            }
        }
        if (!isUnique) {
            callback({ success: false, error: 'Имя уже занято' });
            return;
        }

        const userData = { username };
        users.set(socket.id, userData);
        socket.username = username;

        // Отправляем новому пользователю список онлайн-пользователей (всех, кроме него)
        const userList = Array.from(users.values())
            .filter(u => u.username !== username)
            .map(u => ({ username: u.username }));
        socket.emit('user list', userList);

        // Оповещаем всех остальных о новом пользователе
        socket.broadcast.emit('user joined', { username });

        callback({ success: true, username });
    });

    // Получение списка онлайн-пользователей (для тех, кто уже зарегистрирован)
    socket.on('get users', () => {
        const userList = Array.from(users.values())
            .filter(u => u.username !== socket.username)
            .map(u => ({ username: u.username }));
        socket.emit('user list', userList);
    });

    // Запрос истории сообщений с конкретным пользователем
    socket.on('get history', (targetUsername) => {
        const current = socket.username;
        if (!current) return;
        const key = getDialogKey(current, targetUsername);
        const history = messages.get(key) || [];
        socket.emit('chat history', { target: targetUsername, messages: history });
    });

    // Отправка личного сообщения
    socket.on('private message', ({ to, type, content }) => {
        const from = socket.username;
        if (!from || !to) return;

        const message = {
            id: Date.now() + Math.random(),
            from,
            to,
            type,        // 'text', 'image', 'voice'
            content,     // текст или base64
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };

        const key = getDialogKey(from, to);
        if (!messages.has(key)) messages.set(key, []);
        const dialog = messages.get(key);
        dialog.push(message);
        if (dialog.length > 200) dialog.shift(); // ограничим историю
        saveMessages(); // сохраняем после каждого изменения

        // Отправить отправителю и получателю
        socket.emit('private message', message);
        let recipientId = null;
        for (let [id, u] of users.entries()) {
            if (u.username === to) {
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
        const user = users.get(socket.id);
        if (user) {
            users.delete(socket.id);
            socket.broadcast.emit('user left', user.username);
            console.log(`User ${user.username} disconnected`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});