const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const fs = require("fs");
const express = require("express");
const qrcode = require("qrcode");

// ==== CONFIG ====
const ADMIN_NUMBERS = ["6281256513331@c.us"]; // isi nomor admin tanpa +
const SESSION_FILE = "sessions.json";
const LOG_FILE = "logs.txt";

// ==== SESSION STORAGE ====
let sessions = {};
if (fs.existsSync(SESSION_FILE)) {
  sessions = JSON.parse(fs.readFileSync(SESSION_FILE));
}

// ==== SAVE SESSION ====
function saveSessions() {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

// ==== LOGGING ====
function logMessage(msg) {
  const time = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${time}] ${msg}\n`);
}

// ==== EXPRESS SERVER UNTUK QR ====
const app = express();
let latestQR = null;

app.get("/qr.png", (req, res) => {
  if (fs.existsSync("qr.png")) {
    res.sendFile(__dirname + "/qr.png");
  } else {
    res.send("QR belum tersedia, tunggu sebentar...");
  }
});

app.listen(3000, () => console.log("Server QR jalan di port 3000"));

// ==== WHATSAPP CLIENT ====
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  },
});

client.on("qr", async (qr) => {
  console.log("QR diterima, disimpan sebagai qr.png");
  latestQR = qr;
  await qrcode.toFile("qr.png", qr);
});

client.on("ready", () => {
  console.log("✅ Bot siap digunakan");
});

// ==== REJECT CALL ====
client.on("call", async (call) => {
  if (!ADMIN_NUMBERS.includes(call.from)) {
    await call.reject();
    await client.sendMessage(
      call.from,
      "❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat untuk akses menu."
    );
  }
});

// ==== MENU UTAMA ====
function getMainMenu() {
  return {
    body: "📌 Mohon pilih menu berikut:",
    buttons: [
      { body: "TOP UP" },
      { body: "PESAN PRIBADI" },
      { body: "IZIN CALLING" },
    ],
  };
}

// ==== MESSAGE HANDLER ====
client.on("message", async (msg) => {
  const from = msg.from;

  // Jangan balas admin
  if (ADMIN_NUMBERS.includes(from)) return;

  logMessage(`${from}: ${msg.body}`);

  // Ambil session user
  if (!sessions[from]) {
    sessions[from] = { step: "MAIN_MENU", lastActive: Date.now() };
    saveSessions();
    return client.sendMessage(from, getMainMenu());
  }

  let session = sessions[from];
  session.lastActive = Date.now();

  // ==== HANDLE MENU ====
  switch (session.step) {
    case "MAIN_MENU":
      if (msg.body === "TOP UP") {
        session.step = "TOPUP_MENU";
        saveSessions();
        return client.sendMessage(from, {
          body: "💳 Pilih nominal TOP UP:",
          buttons: [
            { body: "150K" },
            { body: "200K" },
            { body: "300K" },
            { body: "500K" },
            { body: "1/2" },
            { body: "1" },
            { body: "⬅️ Kembali" },
          ],
        });
      } else if (msg.body === "PESAN PRIBADI") {
        session.step = "PESAN_MENU";
        saveSessions();
        return client.sendMessage(from, {
          body: "📋 Pilih jenis pesan pribadi:",
          buttons: [
            { body: "BON" },
            { body: "GADAI" },
            { body: "GADAI HP" },
            { body: "TEBUS GADAI" },
            { body: "LAIN-LAIN" },
            { body: "⬅️ Kembali" },
          ],
        });
      } else if (msg.body === "IZIN CALLING") {
        session.step = "CALL_PENDING";
        session.timeout = Date.now() + 5 * 60 * 1000; // 5 menit
        saveSessions();
        return client.sendMessage(
          from,
          "☎️ Permintaan izin panggilan dikirim. Mohon tunggu admin menyetujui (maks 5 menit)."
        );
      } else {
        return client.sendMessage(from, "❌ Pilihan tidak valid.");
      }

    // ==== TOPUP ====
    case "TOPUP_MENU":
      if (msg.body === "⬅️ Kembali") {
        session.step = "MAIN_MENU";
        saveSessions();
        return client.sendMessage(from, getMainMenu());
      } else if (["150K", "200K", "300K", "500K", "1/2", "1"].includes(msg.body)) {
        session.nominal = msg.body;
        session.step = "TOPUP_CONFIRM";
        saveSessions();
        return client.sendMessage(from, {
          body: `Anda memilih TOP UP ${msg.body}. Pilih metode:`,
          buttons: [{ body: "Bayar" }, { body: "Bon" }, { body: "⬅️ Kembali" }],
        });
      }

      break;

    case "TOPUP_CONFIRM":
      if (msg.body === "⬅️ Kembali") {
        session.step = "TOPUP_MENU";
        saveSessions();
        return client.sendMessage(from, {
          body: "💳 Pilih nominal TOP UP:",
          buttons: [
            { body: "150K" },
            { body: "200K" },
            { body: "300K" },
            { body: "500K" },
            { body: "1/2" },
            { body: "1" },
            { body: "⬅️ Kembali" },
          ],
        });
      } else if (msg.body === "Bayar") {
        session.step = "WAIT_ADMIN";
        saveSessions();
        return client.sendMessage(from, "✅ Pesanan Anda sedang diproses admin...");
      } else if (msg.body === "Bon") {
        session.step = "WAIT_ADMIN";
        saveSessions();
        return client.sendMessage(from, "⌛ Menunggu persetujuan admin untuk BON...");
      }
      break;

    // ==== PESAN PRIBADI ====
    case "PESAN_MENU":
      if (msg.body === "⬅️ Kembali") {
        session.step = "MAIN_MENU";
        saveSessions();
        return client.sendMessage(from, getMainMenu());
      } else if (
        ["BON", "GADAI", "GADAI HP", "TEBUS GADAI", "LAIN-LAIN"].includes(msg.body)
      ) {
        session.step = "WAIT_ADMIN";
        saveSessions();
        return client.sendMessage(from, `⌛ Pesan ${msg.body} dikirim. Menunggu admin...`);
      }
      break;

    case "WAIT_ADMIN":
      // User tidak bisa kirim pesan lagi, kecuali admin balas
      return client.sendMessage(from, "❌ Mohon tunggu admin membalas pesan Anda.");

    case "CALL_PENDING":
      return client.sendMessage(
        from,
        "☎️ Permintaan panggilan sedang diproses. Mohon tunggu..."
      );
  }
});

// ==== AUTO TIMEOUT ====
setInterval(() => {
  const now = Date.now();
  for (const [num, sess] of Object.entries(sessions)) {
    if (sess.step === "CALL_PENDING" && now > sess.timeout) {
      client.sendMessage(num, "⌛ Waktu tunggu izin panggilan habis. Kembali ke menu utama.");
      sessions[num] = { step: "MAIN_MENU", lastActive: now };
      saveSessions();
      client.sendMessage(num, getMainMenu());
    }
    if (sess.step === "WAIT_ADMIN" && now - sess.lastActive > 60 * 60 * 1000) {
      client.sendMessage(num, "⌛ Pesanan kadaluarsa (1 jam). Kembali ke menu utama.");
      sessions[num] = { step: "MAIN_MENU", lastActive: now };
      saveSessions();
      client.sendMessage(num, getMainMenu());
    }
  }
}, 60 * 1000);

client.initialize();
