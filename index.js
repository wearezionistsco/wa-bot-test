const fs = require("fs");
const express = require("express");
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();
const PORT = process.env.PORT || 8080;

// nomor yang dikecualikan dari bot (admin/keluarga)
const EXCLUDE_NUMBERS = ["6281256513331@c.us"];

// simpan sesi user
let sessions = {};
const SESSION_FILE = "sessions.json";

// load sesi lama
if (fs.existsSync(SESSION_FILE)) {
  sessions = JSON.parse(fs.readFileSync(SESSION_FILE));
}

// inisialisasi client whatsapp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", async (qr) => {
  console.log("📲 QR diterima, simpan di qr.png");

  // tampilkan juga di terminal
  qrcode.generate(qr, { small: true });

  // buat link PNG pakai api.qrserver
  const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
    qr
  )}`;

  fs.writeFileSync("logs.txt", `Login QR: ${qrLink}\n`);
  console.log(`✅ Scan QR di sini: ${qrLink}`);
});

client.on("ready", () => {
  console.log("🤖 Bot WhatsApp siap digunakan!");
});

// menu utama
function getMainMenu() {
  return new Buttons(
    "Silakan pilih menu berikut:",
    [
      { body: "TOP UP" },
      { body: "PESAN PRIBADI" },
      { body: "IZIN CALLING" },
    ],
    "📌 MENU UTAMA",
    "Pilih salah satu opsi di bawah:"
  );
}

client.on("message", async (msg) => {
  const from = msg.from;

  // jika nomor admin/keluarga → biarkan
  if (EXCLUDE_NUMBERS.includes(from)) return;

  if (!sessions[from]) {
    // tampilkan menu utama pertama kali
    await client.sendMessage(from, getMainMenu());
    sessions[from] = { step: "menu" };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
    return;
  }

  const step = sessions[from].step;

  // handle menu utama
  if (step === "menu") {
    if (msg.body === "TOP UP") {
      const buttons = new Buttons(
        "Pilih nominal:",
        [
          { body: "150K" },
          { body: "200K" },
          { body: "300K" },
          { body: "500K" },
          { body: "1/2" },
          { body: "1" },
        ],
        "💰 TOP UP",
        "Pilih nominal top up"
      );
      await client.sendMessage(from, buttons);
      sessions[from].step = "topup_nominal";
    } else if (msg.body === "PESAN PRIBADI") {
      const buttons = new Buttons(
        "Pilih kategori:",
        [
          { body: "BON" },
          { body: "GADAI" },
          { body: "GADAI HP" },
          { body: "TEBUS GADAI" },
          { body: "LAIN-LAIN" },
        ],
        "✉️ PESAN PRIBADI",
        "Pilih salah satu opsi"
      );
      await client.sendMessage(from, buttons);
      sessions[from].step = "pesan_pribadi";
    } else if (msg.body === "IZIN CALLING") {
      await client.sendMessage(
        from,
        "☎️ Permintaan izin panggilan sedang diproses. Silakan tunggu admin."
      );
      sessions[from].step = "izin_call";
    }
  }

  // handle topup nominal
  else if (step === "topup_nominal") {
    sessions[from].nominal = msg.body;
    const buttons = new Buttons(
      `Anda memilih ${msg.body}. Lanjutkan?`,
      [{ body: "BAYAR" }, { body: "BON" }, { body: "KEMBALI" }],
      "✅ Konfirmasi",
      "Pilih salah satu"
    );
    await client.sendMessage(from, buttons);
    sessions[from].step = "topup_confirm";
  }

  // handle topup confirm
  else if (step === "topup_confirm") {
    if (msg.body === "BAYAR") {
      await client.sendMessage(
        from,
        `💳 Pembayaran sebesar ${sessions[from].nominal} sedang diproses admin.`
      );
      sessions[from].step = "menunggu_admin";
    } else if (msg.body === "BON") {
      await client.sendMessage(
        from,
        `📝 Permintaan BON ${sessions[from].nominal} menunggu persetujuan admin.`
      );
      sessions[from].step = "menunggu_admin";
    } else if (msg.body === "KEMBALI") {
      await client.sendMessage(from, getMainMenu());
      sessions[from].step = "menu";
    }
  }

  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
});

client.initialize();

// server express (agar Railway tetap hidup)
app.get("/", (req, res) => {
  res.send("🤖 WhatsApp Bot Aktif");
});

app.listen(PORT, () => {
  console.log(`🌐 Server berjalan di port ${PORT}`);
});
