// MOOD MAPPING V3 - "SEARCH ANYWHERE" & CHAT SERVER
// -------------------------------------------------

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");

// 1. SETUP
const app = express();
const PORT = process.env.PORT || 3001; // Matching the Frontend Port
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
// Increased limit so you can upload Profile Pictures
app.use(bodyParser.json({ limit: '10mb' })); 

// 2. DATABASE
const dbPath = path.resolve(__dirname, 'mood_mapping.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Users table now has Username and Avatar
    db.run(`CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, username TEXT, avatar TEXT)`);
    
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
        submission_id TEXT PRIMARY KEY, 
        user_id TEXT, 
        mood_level INTEGER, 
        lat REAL, 
        lon REAL, 
        tag TEXT, 
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// 3. REAL-TIME CHAT (Socket.io)
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User "logs in" so we know who they are
    socket.on('register_socket', (userId) => {
        socket.join(userId); 
        console.log(`User ${userId} is ready to chat`);
    });

    // Handle Private Messages
    socket.on('send_private_message', (data) => {
        const { targetUserId, text, senderName, senderId } = data;
        
        // Send to the specific user
        io.to(targetUserId).emit('receive_private_message', {
            text,
            senderName,
            senderId,
            isSelf: false
        });
    });
});

// 4. API ENDPOINTS

// A. Update Profile (Name & Pic)
app.post('/api/v1/user/update', (req, res) => {
    const { user_id, username, avatar } = req.body;
    const sql = `INSERT OR REPLACE INTO users (user_id, username, avatar) VALUES (?, ?, ?)`;
    
    db.run(sql, [user_id, username, avatar], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: "success" });
    });
});

// B. Submit Mood
app.post('/api/v1/mood/submit', (req, res) => {
    const { user_id, mood_level, lat, lon } = req.body;
    const id = uuidv4();
    const sql = `INSERT INTO submissions (submission_id, user_id, mood_level, lat, lon) VALUES (?,?,?,?,?)`;
    
    db.run(sql, [id, user_id, mood_level, lat, lon], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: "success" });
    });
});

// C. FIND MATCHES (The "Search Anywhere" Logic)
app.get('/api/v1/mood/matches', (req, res) => {
    const { mood, user_id, search_lat, search_lon } = req.query;

    // Get everyone with the same mood (except yourself)
    const sql = `
        SELECT s.user_id, u.username, u.avatar, s.lat, s.lon, s.created_at 
        FROM submissions s
        JOIN users u ON s.user_id = u.user_id
        WHERE s.mood_level = ? AND s.user_id != ?
        ORDER BY s.created_at DESC LIMIT 50
    `;

    db.all(sql, [mood, user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let results = rows;

        // If user provided a Search Map Target, filter by distance
        if (search_lat && search_lon) {
            const targetLat = parseFloat(search_lat);
            const targetLon = parseFloat(search_lon);
            const MAX_RADIUS_KM = 100; // Look within 100km of the pin

            results = rows.filter(user => {
                const dist = getDistanceFromLatLonInKm(targetLat, targetLon, user.lat, user.lon);
                return dist <= MAX_RADIUS_KM;
            });
        }

        res.json({ matches: results });
    });
});

// --- Helper Math Function (Distance) ---
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of earth in km
  var dLat = deg2rad(lat2-lat1); 
  var dLon = deg2rad(lon2-lon1); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; 
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI/180)
}

// 5. START SERVER
server.listen(PORT, () => {
    console.log(`MOOD V3 Server running on port ${PORT} 🚀`);
});