const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const mysql = require('mysql');
const url = require('url');
const handleSubscribePoints = require('./handlers/subscribe_points');
const handleDepositEvent = require('./handlers/deposit_event');
const handlePlaceBet = require('./handlers/place_bet');
const handlePlaceMultiBet = require('./handlers/place_multi_bet');
const handleClearBets = require('./handlers/delete_bet');
// SSL সার্টিফিকেট
const server = https.createServer();
// MySQL সংযোগ
const db = mysql.createConnection({
	host: 'localhost',
	user: 'wheel_game',
	password: 'wheel_game',
	database: 'wheel_game'
});
db.connect(err => {
	if(err) {
		console.error('MySQL সংযোগ ব্যর্থ:', err);
		process.exit(1);
	}
	console.log('MySQL সংযোগ সফল');
});
// WebSocket সার্ভার শুরু
const wss = new WebSocket.Server({
	server
});
let roundSerial = 100000000000;
// 🔁 রাউন্ড সিরিয়াল ইনিশিয়ালাইজেশন
function initializeSerial(callback) {
	db.query('SELECT round_serial FROM rounds ORDER BY id DESC LIMIT 1', (err, results) => {
		if(err) {
			console.error('Serial Initialization Error:', err);
			roundSerial = 100000000000; // fallback
			return callback();
		}
		if(results.length > 0) {
			roundSerial = parseInt(results[0].round_serial);
		} else {
			roundSerial = 100000000000;
		}
		console.log(`🔢 প্রাথমিক roundSerial সেট হয়েছে: ${roundSerial}`);
		callback();
	});
}

















function startNewRound() {
	roundSerial += 1;
	const currentRoundSerial = roundSerial.toString();

	db.query('INSERT INTO rounds (round_serial) VALUES (?)', [currentRoundSerial], (err) => {
		if (err) {
			console.error('DB Insert Error:', err);
			return;
		}

		// রাউন্ড শুরু
		const startMessage = {
			type: 'round_started',
			round_serial: currentRoundSerial,
			joining_time: 35,
			progress_time: 40
		};

		wss.clients.forEach(client => {
			if (client.readyState === WebSocket.OPEN) {
				client.send(JSON.stringify(startMessage));
			}
		});

		// 40 সেকেন্ড পরে ফলাফল
		setTimeout(() => {
			const betQuery = `
				SELECT numbers.bet_number, IFNULL(SUM(b.bet_amount), 0) AS total
				FROM (
					SELECT 0 AS bet_number UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
					UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
				) AS numbers
				LEFT JOIN bets b ON b.bet_number = numbers.bet_number AND b.round_serial = ?
				GROUP BY numbers.bet_number
			`;

			db.query(betQuery, [currentRoundSerial], (err, results) => {
				let resultNumber = Math.floor(Math.random() * 10); // fallback

				if (err) {
					console.error('বেট তথ্য আনতে ব্যর্থ:', err);
				} else if (results.length === 10) {
					const noBetNumbers = results.filter(r => Number(r.total) === 0).map(r => r.bet_number);

					if (noBetNumbers.length === 10) {
						resultNumber = Math.floor(Math.random() * 10);
					} else if (noBetNumbers.length > 0) {
						resultNumber = noBetNumbers[Math.floor(Math.random() * noBetNumbers.length)];
					} else {
						const minTotal = Math.min(...results.map(r => Number(r.total)));
						const lowestBetNumbers = results.filter(r => Number(r.total) === minTotal).map(r => r.bet_number);
						resultNumber = lowestBetNumbers[Math.floor(Math.random() * lowestBetNumbers.length)];
					}
				}

				// রেজাল্ট আপডেট
				db.query('UPDATE rounds SET result = ?, ended_at = NOW() WHERE round_serial = ?', [resultNumber, currentRoundSerial], (err) => {
					if (err) {
						console.error('ফলাফল আপডেট ব্যর্থ:', err);
						return;
					}

					// STEP 1: বিজয়ীদের তথ্য
					db.query('SELECT user_id, bet_amount FROM bets WHERE round_serial = ? AND bet_number = ?', [currentRoundSerial, resultNumber], (err, winners) => {
						if (err) {
							console.error('বিজয়ীদের তথ্য আনতে ত্রুটি:', err);
							return;
						}

						// STEP 2: হেরে যাওয়া বেটগুলোর status 'lost' করা
						db.query('UPDATE bets SET status = "lost" WHERE round_serial = ? AND bet_number != ?', [currentRoundSerial, resultNumber], (err) => {
							if (err) console.error('হারা বেট আপডেটে ত্রুটি:', err);
						});

						if (winners.length > 0) {
							const caseBalance = [];
							const caseStatus = [];
							const userIds = [];
							const betUserIds = [];

							winners.forEach(w => {
								const winAmount = Number(w.bet_amount) * 9;
								caseBalance.push(`WHEN ${w.user_id} THEN balance + ${winAmount}`);
								caseStatus.push(`WHEN ${w.user_id} THEN 'won'`);
								userIds.push(w.user_id);
								betUserIds.push(w.user_id);
							});

							// STEP 3: বিজয়ীদের balance আপডেট
							const balanceUpdateQuery = `
								UPDATE users
								SET balance = CASE id
									${caseBalance.join(' ')}
								END
								WHERE id IN (${userIds.join(',')})
							`;

							// STEP 4: বিজয়ীদের বেট status 'won' করা
							const statusUpdateQuery = `
								UPDATE bets
								SET status = 'won'
								WHERE round_serial = ? AND bet_number = ? AND user_id IN (${betUserIds.join(',')})
							`;

							db.query(balanceUpdateQuery, (err) => {
								if (err) console.error('ব্যালেন্স আপডেটে ত্রুটি:', err);
							});

							db.query(statusUpdateQuery, [currentRoundSerial, resultNumber], (err) => {
								if (err) console.error('বেট স্ট্যাটাস আপডেটে ত্রুটি:', err);
							});
						}
					});

					// STEP 5: স্পিন রেজাল্ট ক্লায়েন্টে
					const spinMessage = {
						type: 'wheel_spin',
						round_serial: currentRoundSerial,
						spin_duration: 8,
						result: resultNumber
					};

					wss.clients.forEach(client => {
						if (client.readyState === WebSocket.OPEN) {
							client.send(JSON.stringify(spinMessage));
						}
					});
				});
			});
		}, 40000);

		// 48 সেকেন্ড পর রাউন্ড হিস্টোরি
		setTimeout(() => {
			db.query('SELECT result FROM rounds WHERE result IS NOT NULL ORDER BY id DESC LIMIT 10', (err, rows) => {
				if (err) {
					console.error('হিস্টোরি লোড ত্রুটি:', err);
					return;
				}
				const historyList = rows.map(row => row.result);
				const resultMessage = {
					type: 'round_result',
					round_serial: currentRoundSerial,
					show_duration: 10,
					history: historyList
				};
				wss.clients.forEach(client => {
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify(resultMessage));
					}
				});
			});
		}, 48000);

		// 58 সেকেন্ড পর আবার নতুন রাউন্ড শুরু
		setTimeout(startNewRound, 58000);
	});
}




















wss.on('connection', ws => {
	console.log('🔗 নতুন ক্লায়েন্ট সংযুক্ত হয়েছে');
	ws.on('message', message => {
		console.log('📩 প্রাপ্ত বার্তা:', message);
		let data;
		try {
			data = JSON.parse(message);
		} catch(e) {
			ws.send(JSON.stringify({
				type: 'error',
				message: 'অবৈধ JSON ফর্ম্যাট'
			}));
			return;
		}
		
		 
		
		switch (data.type) {
	case 'subscribe_points':
		handleSubscribePoints(ws, db, data);
		break;
	case 'deposit_event':
		handleDepositEvent(ws, db, data);
		break;
	case 'place_bet':
		handlePlaceBet(ws, db, data);
		break;
	case 'place_multi_bet':
		handlePlaceMultiBet(ws, db, data);
		break;
	case 'clear_bet':
	case 'delete_bet':
		handleClearBets(ws, db, data);
		break;
	default:
		ws.send(JSON.stringify({
			type: 'error',
			message: 'অজানা বার্তার ধরন'
		}));
}

		
		
		
		
		
		
		
		
	});
	ws.on('close', () => {
		console.log('❌ ক্লায়েন্ট সংযোগ বিচ্ছিন্ন হয়েছে');
	});
});
// ✅ সার্ভার চালু হলে প্রথমে সিরিয়াল সেট, তারপর রাউন্ড চালু
server.listen(8080, () => {
	console.log('✅ Secure WebSocket চালু হয়েছে: wss://jeeto.site:8080');
	initializeSerial(() => {
		startNewRound();
	});
});
