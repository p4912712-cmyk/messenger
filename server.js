const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Хранилище данных
const users = new Map(); // socketId -> { username }
const messages = new Map(); // `${username1}:${username2}` -> массив сообщений

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Регистрация пользователя
    socket.on('register', (username, callback) => {
        // Проверка уникальности имени
        let isUnique = true;
        for (let [id, user] of users.entries()) {
            if (user.username === username && id !== socket.id) {
                isUnique = false;
                break;
            }
        }
        if (!isUnique) {
            callback({ success: false, error: 'Username already taken' });
            return;
        }

        // Сохраняем пользователя
        users.set(socket.id, { username, socketId: socket.id });
        socket.username = username;

        // Отправляем текущему пользователю список всех пользователей
        const userList = Array.from(users.values()).map(u => ({ username: u.username, socketId: u.socketId }));
        socket.emit('user list', userList);

        // Оповещаем всех о новом пользователе
        socket.broadcast.emit('user joined', { username, socketId: socket.id });

        callback({ success: true, username });
    });

    // Получение списка пользователей (для тех, кто уже зарегистрирован)
    socket.on('get users', () => {
        const userList = Array.from(users.values()).map(u => ({ username: u.username, socketId: u.socketId }));
        socket.emit('user list', userList);
    });

    // Запрос истории сообщений с конкретным пользователем
    socket.on('get history', (targetUsername) => {
        const currentUsername = socket.username;
        if (!currentUsername) return;
        const key = getMessagesKey(currentUsername, targetUsername);
        const history = messages.get(key) || [];
        socket.emit('chat history', { target: targetUsername, messages: history });
    });

    // Отправка личного сообщения
    socket.on('private message', ({ to, text }) => {
        const from = socket.username;
        if (!from || !to || !text) return;

        const message = {
            from,
            to,
            text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };

        // Сохраняем в историю
        const key = getMessagesKey(from, to);
        if (!messages.has(key)) messages.set(key, []);
        messages.get(key).push(message);
        // Ограничим историю 100 сообщениями на диалог
        if (messages.get(key).length > 100) messages.get(key).shift();

        // Отправляем отправителю подтверждение (чтобы он увидел сообщение у себя)
        socket.emit('private message', message);

        // Отправляем получателю, если он онлайн
        let recipientSocketId = null;
        for (let [id, user] of users.entries()) {
            if (user.username === to) {
                recipientSocketId = id;
                break;
            }
        }
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private message', message);
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

function getMessagesKey(user1, user2) {
    // Сортируем имена для единого ключа диалога
    const [a, b] = [user1, user2].sort();
    return `${a}:${b}`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});