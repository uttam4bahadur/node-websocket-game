module.exports = function handleDepositEvent(ws, db, data) {
  const { receiver_unique_id, amount } = data;

  if (!receiver_unique_id || typeof amount !== 'number' || amount <= 0) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid deposit data'
    }));
    return;
  }

  db.query('SELECT balance FROM users WHERE unique_id = ?', [receiver_unique_id], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      ws.send(JSON.stringify({ type: 'error', message: 'Database error' }));
      return;
    }

    if (results.length === 0) {
      ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
      return;
    }

    db.query(
      'UPDATE users SET balance = balance + ? WHERE unique_id = ?',
      [amount, receiver_unique_id],
      (updateErr) => {
        if (updateErr) {
          console.error("Balance update failed:", updateErr);
          ws.send(JSON.stringify({ type: 'error', message: 'Balance update failed' }));
          return;
        }

        db.query(
          'SELECT balance FROM users WHERE unique_id = ?',
          [receiver_unique_id],
          (finalErr, finalResults) => {
            if (finalErr) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to fetch updated balance' }));
              return;
            }

            const updatedBalance = finalResults[0].balance;

            ws.send(JSON.stringify({
              type: 'deposit_success',
              unique_id: receiver_unique_id,
              new_balance: updatedBalance,
              message: `✅ ৳${amount} deposited successfully`,
              redirect: true,
              redirect_url: 'users/users.php'
            }));
          }
        );
      }
    );
  });
};
