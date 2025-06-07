module.exports = function handlePlaceMultiBet(ws, db, data) {
  const { bets, uniqueId } = data;

  if (!Array.isArray(bets) || !uniqueId) {
    return ws.send(JSON.stringify({
      type: 'error',
      message: 'বেট ডেটা সঠিক নয় বা ইউনিক আইডি অনুপস্থিত।'
    }));
  }

  db.query('SELECT id, balance FROM users WHERE unique_id = ?', [uniqueId], (err, userResults) => {
    if (err || !userResults.length) {
      return ws.send(JSON.stringify({
        type: 'error',
        message: 'ব্যবহারকারী পাওয়া যায়নি।'
      }));
    }

    const user = userResults[0];

    db.query('SELECT round_serial FROM rounds WHERE result IS NULL ORDER BY id DESC LIMIT 1', (err, roundResults) => {
      if (err || !roundResults.length) {
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'সক্রিয় রাউন্ড পাওয়া যায়নি।'
        }));
      }

      const currentRoundSerial = roundResults[0].round_serial;

      db.beginTransaction(err => {
        if (err) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'লেনদেন শুরু ব্যর্থ।'
          }));
        }

        // স্টেপ ১: পূর্বের সব বেট নিয়ে আসা
        db.query('SELECT bet_number, bet_amount, id FROM bets WHERE user_id = ? AND round_serial = ?', [user.id, currentRoundSerial], (err, existingBets) => {
          if (err) {
            return db.rollback(() => {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'আগের বেট আনতে সমস্যা হয়েছে।'
              }));
            });
          }

          let totalAdjustment = 0;
          const betUpdates = [];
          const betInserts = [];

          for (const bet of bets) {
            const { number, bet: newAmount } = bet;

            if (typeof number !== 'number' || typeof newAmount !== 'number') {
              return db.rollback(() => {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'বেটের ফরম্যাট ভুল।'
                }));
              });
            }

            const existing = existingBets.find(b => b.bet_number === number);
            const oldAmount = existing ? existing.bet_amount : 0;

            totalAdjustment += oldAmount - newAmount;

            if (existing) {
              betUpdates.push({ id: existing.id, amount: newAmount });
            } else {
              betInserts.push({ number, amount: newAmount });
            }
          }

          const finalBalance = user.balance + totalAdjustment;

          if (finalBalance < 0) {
            return db.rollback(() => {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'পর্যাপ্ত ব্যালেন্স নেই।'
              }));
            });
          }

          // Step 2: Update এবং Insert গুলি করা
          const updateBets = betUpdates.map(update =>
            new Promise((resolve, reject) => {
              db.query('UPDATE bets SET bet_amount = ? WHERE id = ?', [update.amount, update.id], (err) => {
                return err ? reject(err) : resolve();
              });
            })
          );

          const insertBets = betInserts.map(insert =>
            new Promise((resolve, reject) => {
              db.query(
                'INSERT INTO bets (user_id, bet_number, bet_amount, round_serial) VALUES (?, ?, ?, ?)',
                [user.id, insert.number, insert.amount, currentRoundSerial],
                (err) => {
                  return err ? reject(err) : resolve();
                }
              );
            })
          );

          Promise.all([...updateBets, ...insertBets])
            .then(() => {
              db.query('UPDATE users SET balance = ? WHERE id = ?', [finalBalance, user.id], (err) => {
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
                        message: 'লেনদেন সম্পন্ন ব্যর্থ।'
                      }));
                    });
                  }

                  ws.send(JSON.stringify({
                    type: 'multi_bet_result',
                    success: true,
                    message: 'মাল্টি বেট সফলভাবে সম্পন্ন হয়েছে।',
                    new_balance: finalBalance
                  }));

                  ws.send(JSON.stringify({
                    type: 'points_update',
                    points: finalBalance,
                    unique_id: uniqueId
                  }));
                });
              });
            })
            .catch(err => {
              db.rollback(() => {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'বাজি সংরক্ষণের সময় ত্রুটি হয়েছে।'
                }));
              });
            });
        });
      });
    });
  });
};
