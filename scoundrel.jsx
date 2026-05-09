// ... existing code ...
onClick={() => {
  const serverPayload = { playerName: initials, seed: runSeedString, finalScore: score, actions: actionLog };
  
  // Point this directly to your new validation server
  fetch('https://highscore.c137.dev/api/submit-score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serverPayload)
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      console.log("Server accepted the run!");
      // Only add to local leaderboard if the server validates it
      const newEntry = { name: initials, score, wave };
      const newLb = [...leaderboard, newEntry].sort((a,b) => b.score - a.score).slice(0, 10);
      setLeaderboard(newLb);
      saveLeaderboard(newLb);
      setScoreSubmitted(true);
    } else {
      console.error("Server rejected the run:", data.message);
      alert("Run validation failed: " + data.message);
    }
  })
  .catch(err => {
    console.error("Failed to connect to leaderboard server:", err);
    alert("Could not connect to the high score server.");
  });
}}
// ... existing code ...
