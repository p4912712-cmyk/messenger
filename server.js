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

// Хранилища
const users = new Map();          // socketId -> { username, avatar? }
const messages = new Map();       // key = "user1:user2" -> array
const userAvatars = new Map();    // username -> base64 avatar

function getDialogKey(u1, u2) {
    const [a, b] = [u1, u2].sort();
    return `${a}:${b}`;
}

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Регистрация
    socket.on('register', ({ username, avatar }, callback) => {
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

        const userData = { username, socketId: socket.id };
        if (avatar) userData.avatar = avatar;
        users.set(socket.id, userData);
        socket.username = username;

        if (avatar) userAvatars.set(username, avatar);
        else if (!userAvatars.has(username)) {
            // Аватар по умолчанию – null, клиент сам покажет инициалы
            userAvatars.set(username, null);
        }

        const userList = Array.from(users.values()).map(u => ({
            username: u.username,
            avatar: userAvatars.get(u.username) || null
        }));
        socket.emit('user list', userList);
        socket.broadcast.emit('user joined', {
            username,
            avatar: userAvatars.get(username)
        });

        callback({ success: true, username, avatar: userAvatars.get(username) });
    });

    socket.on('get users', () => {
        const userList = Array.from(users.values()).map(u => ({
            username: u.username,
            avatar: userAvatars.get(u.username) || null
        }));
        socket.emit('user list', userList);
    });

    socket.on('get history', (targetUsername) => {
        const current = socket.username;
        if (!current) return;
        const key = getDialogKey(current, targetUsername);
        const history = messages.get(key) || [];
        socket.emit('chat history', { target: targetUsername, messages: history });
    });

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
        if (dialog.length > 200) dialog.shift();

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

    socket.on('update avatar', (avatarBase64) => {
        const username = socket.username;
        if (username && avatarBase64) {
            userAvatars.set(username, avatarBase64);
            const user = users.get(socket.id);
            if (user) user.avatar = avatarBase64;
            io.emit('avatar updated', { username, avatar: avatarBase64 });
        }
    });

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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));