// MOOD MAPPING - PROFESSIONAL POSTGRES BACKEND
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg'); // Use Postgres
const http = require('http');
const { Server } = require("socket.io");

// SETUP
const app = express();
const PORT = process.env.PORT || 10000; // Render uses 10000 usually
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// DATABASE CONNECTION
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Render
});

// INIT DB (Create Tables if they don't exist)
pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY, 
        username TEXT, 
        avatar TEXT
    );
    CREATE TABLE IF NOT EXISTS submissions (
        submission_id TEXT PRIMARY KEY, 
        user_id TEXT, 
        mood_level INTEGER, 
        lat REAL, 
        lon REAL, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).then(() => console.log("Tables Created")).catch(err => console.error(err));

// --- SOCKET.IO (CHAT) ---
io.on('connection', (socket) => {
    socket.on('register_socket', (userId) => socket.join(userId));
    socket.on('send_private_message', (data) => {
        io.to(data.targetUserId).emit('receive_private_message', data);
    });
});

// --- API ENDPOINTS ---

app.post('/api/v1/user/update', async (req, res) => {
    const { user_id, username, avatar } = req.body;
    try {
        await pool.query(
            `INSERT INTO users (user_id, username, avatar) VALUES ($1, $2, $3) 
             ON CONFLICT (user_id) DO UPDATE SET username = $2, avatar = $3`,
            [user_id, username, avatar]
        );
        res.json({ status: "success" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/v1/mood/submit', async (req, res) => {
    const { user_id, mood_level, lat, lon } = req.body;
    try {
        await pool.query(
            `INSERT INTO submissions (submission_id, user_id, mood_level, lat, lon) VALUES ($1, $2, $3, $4, $5)`,
            [uuidv4(), user_id, mood_level, lat, lon]
        );
        res.json({ status: "success" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/v1/mood/matches', async (req, res) => {
    const { mood, user_id, search_lat, search_lon } = req.query;
    try {
        // Get matches from DB
        const result = await pool.query(
            `SELECT s.user_id, u.username, u.avatar, s.lat, s.lon 
             FROM submissions s JOIN users u ON s.user_id = u.user_id 
             WHERE s.mood_level = $1 AND s.user_id != $2 
             ORDER BY s.created_at DESC LIMIT 50`,
            [mood, user_id]
        );

        // Filter by Distance (Simple Math)
        let matches = result.rows;
        if (search_lat) {
            matches = matches.filter(user => {
                const dist = getDistanceFromLatLonInKm(search_lat, search_lon, user.lat, user.lon);
                return dist <= 5000; 
            });
        }
        res.json({ matches });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Math Helper
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; var dLat = deg2rad(lat2-lat1); var dLon = deg2rad(lon2-lon1); 
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}
function deg2rad(deg) { return deg * (Math.PI/180) }

server.listen(PORT, () => console.log(`Postgres Brain running on ${PORT}`));
