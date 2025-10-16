import express from "express";
import sqlite3 from "sqlite3";
import cron from "node-cron";
import { WebSocketServer } from "ws";
import http from "http";

const app = express();
app.use(express.json());

// --- SQLite setup ---
const db = new sqlite3.Database("counter.db");
db.run("CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER)");
db.get("SELECT * FROM counter WHERE id = 1", (err, row) => {
  if (!row) db.run("INSERT INTO counter (id, value) VALUES (1, 0)");
});

// --- Express routes ---
app.get("/count", (req, res) => {
  db.get("SELECT value FROM counter WHERE id = 1", (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ count: row.value });
  });
});

app.post("/update", (req, res) => {
  const delta = req.body.delta;
  db.run("UPDATE counter SET value = value + ? WHERE id = 1", [delta], err => {
    if (err) return res.status(500).json({ error: err.message });

    db.get("SELECT value FROM counter WHERE id = 1", (err, row) => {
      if (!err) broadcastCount(row.value); // notify all clients
    });

    res.json({ ok: true });
  });
});

// --- Daily reset at 11PM IST ---
cron.schedule("0 23 * * *", () => {
  console.log("Resetting counter at 11PM IST");
  db.run("UPDATE counter SET value = 0 WHERE id = 1", err => {
    if (!err) broadcastCount(0);
  });
}, {
  timezone: "Asia/Kolkata"
});

// --- Serve frontend ---
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Shared Counter</title>
        <style>
          body { font-family: sans-serif; text-align: center; margin-top: 100px; }
          h1 { font-size: 72px; }
          button { font-size: 36px; margin: 10px; width: 80px; height: 80px; }
        </style>
      </head>
      <body>
        <h1 id="count">0</h1>
        <button onclick="updateCount(1)">+</button>
        <button onclick="updateCount(-1)">−</button>
        <script>
          const countEl = document.getElementById('count');

          async function fetchCount() {
            const res = await fetch('/count');
            const data = await res.json();
            countEl.textContent = data.count;
          }

          async function updateCount(delta) {
            await fetch('/update', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ delta })
            });
          }

          // --- WebSocket setup ---
          const ws = new WebSocket(\`ws://\${window.location.host}\`);
          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'countUpdate') {
              countEl.textContent = msg.value;
            }
          };

          fetchCount();
        </script>
      </body>
    </html>
  `);
});

// --- HTTP + WebSocket combined server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track clients
function broadcastCount(value) {
  const payload = JSON.stringify({ type: "countUpdate", value });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

wss.on("connection", (ws) => {
  // Send current count immediately on connection
  db.get("SELECT value FROM counter WHERE id = 1", (err, row) => {
    if (!err) ws.send(JSON.stringify({ type: "countUpdate", value: row.value }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
