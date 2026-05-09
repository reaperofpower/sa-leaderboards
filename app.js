const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors()); // Allows your frontend to talk to your backend
app.use(express.json()); // Parses the incoming JSON payloads

// The route that receives the run data
app.post('/api/submit-score', (req, res) => {
    const { playerName, seed, finalScore, actions } = req.body;
    
    console.log(`[Replay Pending] Verifying run for ${playerName} (Claimed Score: ${finalScore})`);
    
    // TODO: Add the deterministic replay logic here later

    // For now, just send a success response back to the game
    res.status(200).json({ 
        success: true, 
        message: "Run received and pending verification." 
    });
});

// DirectAdmin Passenger handles the port dynamically via process.env.PORT
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Scoundrel API listening on port ${port}`);
});