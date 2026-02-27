import mysql from 'mysql2/promise';

export default async function handler(req, res) {
    const authHeader = req.headers['x-brume-secret'];
    if (authHeader !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: "ACCESS DENIED: Invalid Handshake" });
    }

    const db = await mysql.createConnection(process.env.DATABASE_URL);

    try {
        const { mode } = req.query;

        if (mode === 'stats') {
            const [users] = await db.execute('SELECT COUNT(*) as c FROM players');
            const [money] = await db.execute('SELECT SUM(coins) as c FROM players');
            const [richest] = await db.execute('SELECT name, coins FROM players ORDER BY coins DESC LIMIT 1');
            
            res.json({
                user_count: users[0].c,
                total_economy: money[0].c || 0,
                top_player: richest[0] ? `${richest[0].name} (${richest[0].coins})` : "None"
            });
        }

        if (mode === 'lookup') {
            const { query } = req.body;
            const [rows] = await db.execute(
                'SELECT * FROM players WHERE name = ? OR uuid = ?', 
                [query, query]
            );
            res.json(rows[0] || { error: "Player not found" });
        }

        if (req.method === 'POST' && mode === 'update') {
            const { uuid, coins, level } = req.body;
            await db.execute(
                'UPDATE players SET coins = ?, level = ? WHERE uuid = ?',
                [coins, level, uuid]
            );
            res.json({ success: true, message: `Updated UUID ${uuid}` });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await db.end();
    }
}
