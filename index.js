const { Client, LocalAuth, Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const port = process.env.PORT || 8080;

const SESSION_FILE = path.join(__dirname, 'sessions.json');
const LOG_FILE = path.join(__dirname, 'logs.txt');
let sessions = fs.existsSync(SESSION_FILE) ? JSON.parse(fs.readFileSync(SESSION_FILE)) : {};
let qrShown = false;

// Nomor admin & whitelist
const ADMIN_NUMBER = '6281256513331@c.us';
const WHITELIST = [ADMIN_NUMBER]; 

function saveSessions() {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}
function logMessage(msg) {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

// Express serve qr.png
app.get('/qr', (req, res) => {
    const qrPath = path.join(__dirname, 'qr.png');
    if (fs.existsSync(qrPath)) res.sendFile(qrPath);
    else res.send('QR belum tersedia, tunggu sebentar...');
});
app.listen(port, () => console.log(`🌐 Server berjalan di port ${port}`));

// WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox']
    }
});

// QR Event
client.on('qr', (qr) => {
    const qrPath = path.join(__dirname, 'qr.png');
    qrcode.toFile(qrPath, qr, (err) => {
        if (!err && !qrShown) {
            console.log(`✅ QR diterima dan disimpan sebagai qr.png`);
            console.log(`📌 Scan di: http://localhost:${port}/qr`);
            qrShown = true;
        }
    });
});

client.on('ready', () => {
    console.log('✅ WhatsApp siap digunakan');
    qrShown = false;
});

// Handle incoming call
client.on('call', async (call) => {
    if (!WHITELIST.includes(call.from)) {
        await call.reject();
        client.sendMessage(call.from, "❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat untuk akses menu.");
    }
});

// Handle messages
client.on('message', async (message) => {
    const from = message.from;
    const text = message.body?.trim();
    if (WHITELIST.includes(from)) return; // admin bebas

    logMessage(`${from}: ${text}`);

    // Admin commands
    if (from === ADMIN_NUMBER && text.startsWith('close')) {
        const parts = text.split(' ');
        if (parts[1]) {
            delete sessions[parts[1]];
            client.sendMessage(ADMIN_NUMBER, `✅ Session ${parts[1]} ditutup`);
        } else {
            sessions = {};
            client.sendMessage(ADMIN_NUMBER, `✅ Semua session ditutup`);
        }
        saveSessions();
        return;
    }

    // Session check
    if (!sessions[from]) {
        sessions[from] = { step: 'menu', ts: Date.now() };
        saveSessions();
        return showMainMenu(from);
    }

    const user = sessions[from];
    const now = Date.now();

    // Timeout logic
    if (user.step === 'izin_call' && now - user.ts > 5 * 60 * 1000) {
        delete sessions[from];
        saveSessions();
        return showMainMenu(from);
    }
    if ((user.step === 'pesanan' || user.step === 'topup') && now - user.ts > 60 * 60 * 1000) {
        delete sessions[from];
        saveSessions();
        return showMainMenu(from);
    }

    // Handle menu steps
    switch (user.step) {
        case 'menu':
            if (text === 'TOP UP') {
                user.step = 'topup_nominal';
                user.ts = now;
                saveSessions();
                return showTopupNominal(from);
            } else if (text === 'PESAN PRIBADI') {
                user.step = 'pesanan';
                user.ts = now;
                saveSessions();
                return showPesanPribadi(from);
            } else if (text === 'IZIN CALLING') {
                user.step = 'izin_call';
                user.ts = now;
                saveSessions();
                return client.sendMessage(from, "📞 Permintaan izin panggilan sedang diproses, tunggu admin.");
            } else {
                return client.sendMessage(from, "❌ Pilihan tidak valid. Silakan pilih dari menu yang tersedia.");
            }

        case 'topup_nominal':
            user.nominal = text;
            user.step = 'topup_konfirmasi';
            saveSessions();
            return showTopupKonfirmasi(from, text);

        case 'topup_konfirmasi':
            if (text === 'BON') {
                user.step = 'topup_pending';
                saveSessions();
                return client.sendMessage(from, "🕒 Permintaan Top Up BON menunggu persetujuan admin.");
            } else if (text === 'BAYAR') {
                user.step = 'topup_pending';
                saveSessions();
                return client.sendMessage(from, "💰 Pembayaran segera diproses oleh admin.");
            } else if (text === 'KEMBALI') {
                user.step = 'topup_nominal';
                saveSessions();
                return showTopupNominal(from);
            } else {
                return client.sendMessage(from, "❌ Pilihan tidak valid. Silakan pilih BON / BAYAR / KEMBALI.");
            }
    }
});

// UI Functions
function showMainMenu(to) {
    const btn = new Buttons("📋 Mohon pilih menu berikut:", [
        { body: "TOP UP" },
        { body: "PESAN PRIBADI" },
        { body: "IZIN CALLING" }
    ], "Main Menu", "Silakan pilih:");
    client.sendMessage(to, btn);
}
function showTopupNominal(to) {
    const btn = new Buttons("💰 Pilih nominal Top Up:", [
        { body: "150K" },
        { body: "200K" },
        { body: "300K" },
        { body: "500K" },
        { body: "1/2" },
        { body: "1" }
    ], "Top Up", "Silakan pilih nominal:");
    client.sendMessage(to, btn);
}
function showTopupKonfirmasi(to, nominal) {
    const btn = new Buttons(`Anda memilih Top Up ${nominal}. Konfirmasi:`, [
        { body: "BON" },
        { body: "BAYAR" },
        { body: "KEMBALI" }
    ], "Konfirmasi", "Pilih BON jika hutang, BAYAR jika langsung bayar.");
    client.sendMessage(to, btn);
}
function showPesanPribadi(to) {
    const btn = new Buttons("📩 Pilih jenis pesan pribadi:", [
        { body: "BON" },
        { body: "GADAI" },
        { body: "GADAI HP" },
        { body: "TEBUS GADAI" },
        { body: "LAIN-LAIN" }
    ], "Pesan Pribadi", "Silakan pilih:");
    client.sendMessage(to, btn);
}

client.initialize();
