module.exports = function handlePlaceBet(ws, db, data) {
  const { number, bet, uniqueId: betUniqueId } = data;

  if (typeof number !== 'number' || typeof bet !== 'number' || !betUniqueId) {
    return ws.send(JSON.stringify({
      type: 'error',
      message: 'ত্রুটিপূর্ণ বাজির অনুরোধ'
    }));
  }

  db.query('SELECT id, balance FROM users WHERE unique_id = ?', [betUniqueId], (err, userResults) => {
    if (err || !userResults.length) {
      return ws.send(JSON.stringify({
        type: 'error',
        message: 'ব্যবহারকারী তথ্য আনতে ব্যর্থ'
      }));
    }

    const user = userResults[0];

    db.query('SELECT round_serial FROM rounds WHERE result IS NULL ORDER BY id DESC LIMIT 1', (err, roundResults) => {
      if (err || !roundResults.length) {
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'সক্রিয় রাউন্ড পাওয়া যায়নি'
        }));
      }

      const currentRoundSerial = roundResults[0].round_serial;

      db.beginTransaction(err => {
        if (err) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'লেনদেন শুরু ব্যর্থ'
          }));
        }

        db.query('SELECT id, bet_amount FROM bets WHERE user_id = ? AND bet_number = ? AND round_serial = ?', [user.id, number, currentRoundSerial], (err, betResults) => {
          if (err) {
            return db.rollback(() => {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'বাজির তথ্য আহরণ ব্যর্থ'
              }));
            });
          }

          const previousBetAmount = betResults.length > 0 ? betResults[0].bet_amount : 0;
          const balanceAdjustment = previousBetAmount - bet;
          const newBalance = user.balance + balanceAdjustment;

          if (newBalance < 0) {
            return db.rollback(() => {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'অপর্যাপ্ত ব্যালেন্স'
              }));
            });
          }

          const betQuery = betResults.length > 0
            ? ['UPDATE bets SET bet_amount = ? WHERE id = ?', [bet, betResults[0].id]]
            : ['INSERT INTO bets (user_id, bet_number, bet_amount, round_serial) VALUES (?, ?, ?, ?)', [user.id, number, bet, currentRoundSerial]];

          db.query(betQuery[0], betQuery[1], (err, betQueryResult) => {
            if (err) {
              return db.rollback(() => {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'বাজি সংরক্ষণ ব্যর্থ'
                }));
              });
            }

            db.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], (err) => {
              if (err) {
                return db.rollback(() => {
                  ws.send(JSON.stringify({
                    type: 'error',
                    message: 'ব্যালেন্স আপডেট ব্যর্থ'
                  }));
                });
              }

              
              
              
              
              db.commit(commitErr => {
  if (commitErr) {
    return db.rollback(() => {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'লেনদেন সম্পন্ন ব্যর্থ'
      }));
    });
  }

  // প্রথম মেসেজ: বেট রেজাল্ট
  ws.send(JSON.stringify({
    type: 'bet_result',
    success: true,
    message: betResults.length > 0 ? 'বেট সফলভাবে আপডেট হয়েছে' : 'বেট সফলভাবে গ্রহণ করা হয়েছে',
    betId: betResults.length > 0 ? betResults[0].id : betQueryResult.insertId
  }));

  // দ্বিতীয় মেসেজ: পয়েন্টস আপডেট
  ws.send(JSON.stringify({
    type: 'points_update', 
    points: newBalance,
    unique_id:  betUniqueId
  }));
});

              
              
              
              
              
            });
          });
        });
      });
    });
  });
};
