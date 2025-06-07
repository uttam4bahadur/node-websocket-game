module.exports = function handleSubscribePoints(ws, db, data) {
  const userUniqueId = data.unique_id;

  if (!userUniqueId) {
    ws.send(JSON.stringify({ type: 'error', message: 'User ID missing' }));
    return;
  }

  // প্রথমে ইউজারের ব্যালেন্স বের করুন
  db.query('SELECT balance FROM users WHERE unique_id = ?', [userUniqueId], (err, results) => {
    if (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
      return;
    }

    if (results.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
      return;
    }

    const balance = results[0].balance;

    // এখন শেষ ১০টা রাউন্ড রেজাল্ট আনুন
    db.query('SELECT result FROM rounds WHERE result IS NOT NULL ORDER BY id DESC LIMIT 10', (err2, rows) => {
      if (err2) {
        ws.send(JSON.stringify({ type: 'error', message: 'History load failed' }));
        return;
      }

      const historyList = rows.map(row => row.result);

      // এবার একসাথে ব্যালেন্স + হিস্টোরি পাঠান
      ws.send(JSON.stringify({
        type: 'points_update',
        points: balance,
        unique_id: userUniqueId,
        history: historyList        // 🟢 নতুন অংশ
      }));
    });
  });
};
