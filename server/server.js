const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const app = express();
const PORT =  5000;
const axios = require('axios');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Disable SSL verification for development

// Load SSL/TLS certificates using environment variables
const privateKey = fs.readFileSync(process.env.PRIVATE_KEY_PATH || path.join(__dirname, 'server.key'), 'utf8');
const certificate = fs.readFileSync(process.env.CERTIFICATE_PATH || path.join(__dirname, 'server.cert'), 'utf8');
const credentials = { key: privateKey, cert: certificate };

// Middleware
app.use(cors());


app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Game Data
let players = [];
let currentWord = null;
let impostorId = null;
let stage = 'waiting'; // waiting, asking, voting, results
let currentQuestionIndex = 0;
let readyPlayers = new Set();
let votes = {}; // { votedPlayerId: { count, voters } }
let votedPlayers = new Set();

// Helper Function: Broadcast game state to all clients
const broadcastGameState = (io) => {
  io.emit('game-state-update', {
    players,
    currentWord,
    impostorId,
    stage,
    currentQuestioner: players[currentQuestionIndex],
    readyPlayers: Array.from(readyPlayers),
    votes,
    currentQuestionIndex,
  });
};

// Helper Function: Reset game state for a new round.
const resetGameState = () => {
  stage = 'waiting';
  votes = {};
  votedPlayers.clear();
  currentQuestionIndex = 0;
  players = players.map(player => ({
    ...player,
    word: null,
    highlight: readyPlayers.has(player.id) ? 'ready' : 'none',
  }));
  broadcastGameState(io);
};

// Endpoint to handle user data and photo upload
app.post('/api/upload', upload.single('photo'), (req, res) => {
  
  try {
    const { name } = req.body;
    if (!name || !req.file) {
      return res.status(400).json({ error: 'بارك الله فيك , مطلوب الاسم والصورة ' });
    }

    const existingPlayer = players.find((p) => p.name === name);
    if (existingPlayer) {
      return res.status(400).json({ error: 'الاسم موجود' });
    }

    const newPlayer = {
      id: Date.now().toString(),
      name,
      photoUrl: `/uploads/${req.file.filename}`,
      score: 0,
      highlight: 'none', // possible values: 'none', 'ready', 'caught', 'winner'
      word: null,
    };
    players.push(newPlayer);
    broadcastGameState(io);
    res.json({ success: true, player: newPlayer });
  } catch (error) {
    console.error('مشكلة في تحميل الصورة.', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint to mark a player as ready
app.post('/api/ready', (req, res) => {
  try {
    const { playerId } = req.body;
    if (!playerId) {
      return res.status(400).json({ error: 'Player ID is required.' });
    }

    readyPlayers.add(playerId);
    players = players.map(player => {
      if (player.id === playerId) {
        return { ...player, highlight: 'ready' };
      }
      return player;
    });

    if (readyPlayers.size === players.length && players.length >= 3) {
      const words = ['اسد', 'نمر', 'فيل', 'زرافة', 'حمار وحشي'];
      currentWord = words[Math.floor(Math.random() * words.length)];
      impostorId = players[Math.floor(Math.random() * players.length)].id;

      players = players.map(player => ({
        ...player,
        word: player.id === impostorId ? 'Impostor' : currentWord,
        highlight: 'none',
      }));
      stage = 'asking';
      currentQuestionIndex = 0;
      readyPlayers.clear();
      votes = {};
      votedPlayers.clear();
      broadcastGameState(io);
    } else {
      broadcastGameState(io);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking player as ready:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint to move to the next stage
app.post('/api/next-stage', (req, res) => {
  try {
    if (stage === 'asking') {
      currentQuestionIndex = (currentQuestionIndex + 1) % players.length;
      if (currentQuestionIndex === 0) {
        stage = 'voting';
      }
    } else if (stage === 'voting') {
      stage = 'results';
      let mostVotedPlayerId = null;
      let maxVotes = 0;
      for (const [playerId, voteData] of Object.entries(votes)) {
        if (voteData.count > maxVotes) {
          mostVotedPlayerId = playerId;
          maxVotes = voteData.count;
        }
      }
      players = players.map(player => ({ ...player, highlight: 'none' }));
      if (mostVotedPlayerId === impostorId) {
        players = players.map(player => {
          if (player.id === impostorId) {
            return { ...player, highlight: 'caught' };
          }
          return { ...player, score: player.score + 100 };
        });
      } else {
        players = players.map(player => {
          if (player.id === impostorId) {
            return { ...player, score: player.score + 100, highlight: 'winner' };
          }
          return player;
        });
      }
    } else if (stage === 'results') {
      resetGameState();
    }
    broadcastGameState(io);
    res.json({ success: true, stage, currentQuestioner: players[currentQuestionIndex] });
  } catch (error) {
    console.error('Error moving to next stage:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint to handle votes
app.post('/api/vote', (req, res) => {
  try {
    const { voterId, votedPlayerId } = req.body;
    if (!voterId || !votedPlayerId) {
      return res.status(400).json({ error: 'Voter ID and voted player ID are required.' });
    }
    if (voterId === votedPlayerId) {
      return res.status(400).json({ error: 'You cannot vote for yourself.' });
    }
    if (votedPlayers.has(voterId)) {
      return res.status(400).json({ error: 'You have already voted in this round.' });
    }

    const voter = players.find((p) => p.id === voterId);
    const votedPlayer = players.find((p) => p.id === votedPlayerId);
    if (!voter || !votedPlayer) {
      return res.status(400).json({ error: 'Invalid player IDs.' });
    }

    votedPlayers.add(voterId);
    if (!votes[votedPlayerId]) {
      votes[votedPlayerId] = { count: 0, voters: [] };
    }
    votes[votedPlayerId].count += 1;
    votes[votedPlayerId].voters.push(voter.name);

    if (votedPlayers.size === players.length) {
      stage = 'results';
      votedPlayers.clear();
    }
    broadcastGameState(io);
    res.json({ success: true, voter, votedPlayer });
  } catch (error) {
    console.error('Error handling vote:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint to get a player by name
app.get('/api/player/:name', (req, res) => {
  try {
    const { name } = req.params;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required.' });
    }
    const player = players.find((p) => p.name === name);
    if (!player) {
      return res.status(404).json({ error: 'Player not found.' });
    }
    res.json({ success: true, player });
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Endpoint to get the current game state
app.get('/api/game-state', (req, res) => {
  try {
    res.json({
      players,
      currentWord,
      impostorId,
      stage,
      currentQuestioner: players[currentQuestionIndex],
      readyPlayers: Array.from(readyPlayers),
      votes,
      currentQuestionIndex,
    });
  } catch (error) {
    console.error('Error fetching game state:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Create HTTPS server
const httpsServer = https.createServer(credentials, app);
const io = new Server(httpsServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Redirect HTTP to HTTPS
const httpServer = http.createServer((req, res) => {
  res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
  res.end();
});

// Socket.IO connection for real-time updates
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  socket.emit('game-state-update', {
    players,
    currentWord,
    impostorId,
    stage,
    currentQuestioner: players[currentQuestionIndex],
    readyPlayers: Array.from(readyPlayers),
    votes,
    currentQuestionIndex,
  });
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Enable HSTS (HTTP Strict Transport Security)
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Start servers
httpsServer.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTPS Server is running on https://0.0.0.0:${PORT}`);
});

httpServer.listen(80, '0.0.0.0', () => {
  console.log('HTTP Server is running on http://0.0.0.0:80 (redirecting to HTTPS)');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP and HTTPS servers');
  httpServer.close(() => {
    console.log('HTTP Server closed.');
  });
  httpsServer.close(() => {
    console.log('HTTPS Server closed.');
  });
});