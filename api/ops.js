import mysql from 'mysql2/promise';

export default async function handler(req, res) {
    const db = await mysql.createConnection(process.env.DATABASE_URL);

    try {
        const { mode } = req.query;

        if (req.method === 'POST' && mode === 'login') {
            const { username, password } = req.body;
            
            const [admins] = await db.execute('SELECT * FROM admins WHERE username = ?', [username]);
            const admin = admins[0];

            if (!admin || admin.password !== password) {
                return res.status(401).json({ error: "Invalid username or password" });
            }

            const token = Buffer.from(`${admin.username}-${Date.now()}`).toString('base64');
            
            await db.execute('UPDATE admins SET token = ? WHERE id = ?', [token, admin.id]);

            return res.json({
                success: true,
                token: token,
                user: { username: admin.username, role: admin.role }
            });
        }

        const authHeader = req.headers['authorization'];
        if (!authHeader) return res.status(401).json({ error: "Missing authorization token" });
        
        const token = authHeader.split(' ')[1];
        const [session] = await db.execute('SELECT * FROM admins WHERE token = ?', [token]);
        
        if (session.length === 0) {
            return res.status(401).json({ error: "Session expired or invalid" });
        }
        
        const currentUser = session[0];

        if (mode === 'stats' && ['admin', 'mod'].includes(currentUser.role)) {
            const [users] = await db.execute('SELECT COUNT(*) as c FROM players');
            const [money] = await db.execute('SELECT SUM(coins) as c FROM players');
            const [richest] = await db.execute('SELECT name, coins FROM players ORDER BY coins DESC LIMIT 1');
            
            return res.json({
                user_count: users[0].c,
                total_economy: money[0].c || 0,
                top_player: richest[0] ? `${richest[0].name} (${richest[0].coins})` : "None"
            });
        }

        if (mode === 'lookup' &&['admin', 'mod'].includes(currentUser.role)) {
            const { query } = req.body;
            const[rows] = await db.execute('SELECT * FROM players WHERE name = ? OR uuid = ?', [query, query]);
            return res.json(rows[0] || { error: "Player not found" });
        }

        if (req.method === 'POST' && mode === 'update' && currentUser.role === 'admin') {
            const { uuid, coins, level } = req.body;
            await db.execute('UPDATE players SET coins = ?, level = ? WHERE uuid = ?', [coins, level, uuid]);
            return res.json({ success: true, message: `Updated UUID ${uuid}` });
        }

        return res.status(403).json({ error: "Forbidden: You do not have permission for this action." });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await db.end();
    }
}
