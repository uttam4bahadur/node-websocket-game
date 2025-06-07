module.exports = function handleClearBet(ws, db, data) {
  const { uniqueId } = data;

  if (!uniqueId) {
    return ws.send(JSON.stringify({
      type: 'error',
      message: 'ইউনিক আইডি অনুপস্থিত।'
    }));
  }

  db.query('SELECT id, balance FROM users WHERE unique_id = ?', [uniqueId], (err, userResults) => {
    if (err || !userResults.length) {
      return ws.send(JSON.stringify({
        type: 'error',
        message: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি।'
      }));
    }

    const user = userResults[0];

    db.query('SELECT round_serial FROM rounds WHERE result IS NULL ORDER BY id DESC LIMIT 1', (err, roundResults) => {
      if (err || !roundResults.length) {
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'সক্রিয় রাউন্ড খুঁজে পাওয়া যায়নি।'
        }));
      }

      const currentRoundSerial = roundResults[0].round_serial;

      db.beginTransaction(err => {
        if (err) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'লেনদেন শুরু করতে ব্যর্থ।'
          }));
        }

        db.query('SELECT id, bet_amount FROM bets WHERE user_id = ? AND round_serial = ?', [user.id, currentRoundSerial], (err, betResults) => {
          if (err) {
            return db.rollback(() => {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'বেট তালিকা আনতে ব্যর্থ।'
              }));
            });
          }

          if (!betResults.length) {
            return db.rollback(() => {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'এই রাউন্ডে কোনো বেট পাওয়া যায়নি।'
              }));
            });
          }

          const totalRefund = betResults.reduce((sum, bet) => sum + bet.bet_amount, 0);
          const updatedBalance = user.balance + totalRefund;
          const betIds = betResults.map(b => b.id);

          db.query('DELETE FROM bets WHERE id IN (?)', [betIds], (err) => {
            if (err) {
              return db.rollback(() => {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'বেট ডিলিট করতে ব্যর্থ।'
                }));
              });
            }

            db.query('UPDATE users SET balance = ? WHERE id = ?', [updatedBalance, user.id], (err) => {
              if (err) {
                return db.rollback(() => {
                  ws.send(JSON.stringify({
                    type: 'error',
                    message: 'ব্যালেন্স আপডেট ব্যর্থ।'
                  }));
                });
              }

              db.commit(commitErr => {
                if (commitErr) {
                  return db.rollback(() => {
                    ws.send(JSON.stringify({
                      type: 'error',
                      message: 'লেনদেন সম্পন্ন করতে ব্যর্থ।'
                    }));
                  });
                }

                ws.send(JSON.stringify({
                  type: 'clear_bet_result',
                  success: true,
                  message: 'সব বেট মুছে ফেলা হয়েছে এবং ব্যালেন্স ফেরত দেওয়া হয়েছে।'
                }));

                ws.send(JSON.stringify({
                  type: 'points_update',
                  points: updatedBalance,
                  unique_id: uniqueId
                }));
              });
            });
          });
        });
      });
    });
  });
};
