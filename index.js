// index.js
const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const express = require('express');
const path = require('path');

// ================= CONFIG ==================
const ADMIN_NUMBERS = ['6281256513331']; // nomor admin/bot, tidak dibalas otomatis
const SESSION_FILE = './sessions.json';
const LOG_FILE = './logs.txt';
const QR_FILE = './qr.png';
const PORT = process.env.PORT || 3000;

// ================= STATE SESSION ==================
let sessions = {};
if (fs.existsSync(SESSION_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE));
}
function saveSessions() {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}
function logMessage(msg) {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

// ================= EXPRESS SERVER (untuk QR) ==================
const app = express();
app.get('/', (req, res) => res.send('WhatsApp Bot Running 🚀'));
app.get('/qr', (req, res) => {
    if (fs.existsSync(QR_FILE)) {
        res.sendFile(path.join(__dirname, 'qr.png'));
    } else {
        res.send('❌ QR belum tersedia, tunggu beberapa saat...');
    }
});
app.listen(PORT, () => console.log(`🌐 Server running at http://localhost:${PORT}`));

// ================= WHATSAPP CLIENT ==================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

// ================= QR HANDLING ==================
client.on('qr', async qr => {
    console.log('📌 QR diterima, scan via /qr di Railway...');
    logMessage('QR diterima');
    await qrcode.toFile(QR_FILE, qr); // simpan ke qr.png
});

// ================= READY ==================
client.on('ready', () => {
    console.log('✅ WhatsApp Bot siap!');
    logMessage('Bot started');
});

// ================= MENU ==================
function getMainMenu() {
    return new Buttons(
        "Mohon pilih menu berikut 👇",
        [
            { body: "TOP UP" },
            { body: "PESAN PRIBADI" },
            { body: "IZIN CALLING" }
        ],
        "📌 MENU UTAMA"
    );
}

function getTopupMenu() {
    return new Buttons(
        "Silakan pilih nominal Top Up 👇",
        [
            { body: "150K" },
            { body: "200K" },
            { body: "300K" },
            { body: "500K" },
            { body: "1/2" },
            { body: "1" }
        ],
        "💰 TOP UP"
    );
}

function getPesanPribadiMenu() {
    return new Buttons(
        "Silakan pilih jenis pesan pribadi 👇",
        [
            { body: "BON" },
            { body: "GADAI" },
            { body: "GADAI HP" },
            { body: "TEBUS GADAI" },
            { body: "LAIN-LAIN" }
        ],
        "✉️ PESAN PRIBADI"
    );
}

// ================= MESSAGE HANDLER ==================
client.on('message', async msg => {
    const from = msg.from.replace('@c.us', '');

    // Jangan balas admin
    if (ADMIN_NUMBERS.includes(from)) return;

    logMessage(`Pesan dari ${from}: ${msg.body}`);

    // Mulai session baru
    if (!sessions[from]) {
        sessions[from] = { step: 'menu', last: Date.now() };
        saveSessions();
        return client.sendMessage(msg.from, getMainMenu());
    }

    let state = sessions[from];
    state.last = Date.now();

    // Handle pilihan user
    if (state.step === 'menu') {
        if (msg.body === "TOP UP") {
            state.step = 'topup';
            saveSessions();
            return client.sendMessage(msg.from, getTopupMenu());
        } else if (msg.body === "PESAN PRIBADI") {
            state.step = 'pesan';
            saveSessions();
            return client.sendMessage(msg.from, getPesanPribadiMenu());
        } else if (msg.body === "IZIN CALLING") {
            state.step = 'izin_call';
            saveSessions();
            return client.sendMessage(msg.from, "❌ Maaf, panggilan tidak diizinkan. Gunakan chat.");
        } else {
            return client.sendMessage(msg.from, "❌ Pilihan tidak valid.\n\n" + getMainMenu().body);
        }
    }

    if (state.step === 'topup') {
        let pilihan = msg.body;
        state.topup = pilihan;
        state.step = 'konfirmasi_topup';
        saveSessions();
        return client.sendMessage(msg.from, new Buttons(
            `Anda memilih nominal *${pilihan}*.\nApakah Anda yakin?`,
            [{ body: "✅ YA" }, { body: "🔙 Kembali" }],
            "Konfirmasi Top Up"
        ));
    }

    if (state.step === 'konfirmasi_topup') {
        if (msg.body === "✅ YA") {
            state.step = 'pending_admin';
            saveSessions();
            return client.sendMessage(msg.from, "✅ Permintaan Top Up sudah dicatat.\nSilakan tunggu admin menyetujui.");
        } else if (msg.body === "🔙 Kembali") {
            state.step = 'topup';
            saveSessions();
            return client.sendMessage(msg.from, getTopupMenu());
        }
    }

    if (state.step === 'pesan') {
        state.step = 'pending_admin';
        state.pesan = msg.body;
        saveSessions();
        return client.sendMessage(msg.from, "✅ Pesan Anda sudah dicatat.\nSilakan tunggu admin merespon.");
    }

    if (state.step === 'izin_call') {
        state.step = 'menu';
        saveSessions();
        return client.sendMessage(msg.from, "❌ Panggilan ditolak.\nKembali ke menu utama.");
    }
});

// ================= CALL REJECT ==================
client.on('call', async call => {
    const from = call.from.replace('@c.us', '');
    if (!ADMIN_NUMBERS.includes(from)) {
        await call.reject();
        client.sendMessage(call.from, "❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat.");
    }
});

// ================= AUTO TIMEOUT SESSION ==================
setInterval(() => {
    let now = Date.now();
    for (let user in sessions) {
        let diff = (now - sessions[user].last) / 60000; // menit
        if (sessions[user].step === 'izin_call' && diff > 5) {
            delete sessions[user];
            client.sendMessage(user + '@c.us', "⌛ Sesi Anda berakhir otomatis.\nKembali ke menu utama.");
        }
        if (sessions[user].step === 'pending_admin' && diff > 60) {
            delete sessions[user];
            client.sendMessage(user + '@c.us', "⌛ Sesi Anda ditutup otomatis karena tidak ada respon.\nKembali ke menu utama.");
        }
    }
    saveSessions();
}, 60000);

// ================= START BOT ==================
client.initialize();
