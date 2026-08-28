/**
 * BRUME CONTROL PLANE — CORE ENGINE
 * Full Production Client Application
 */

const app = {
    session: null,
    activeView: 'overview',
    refreshTimer: null,
    refreshIntervalMs: 15000,
    charts: {},

    // ══════════════════════════════════════════════════════════
    // 1. INITIALIZATION & AUTHENTICATION
    // ══════════════════════════════════════════════════════════

    init() {
        const savedSession = localStorage.getItem('brume_session');
        if (savedSession) {
            try {
                this.session = JSON.parse(savedSession);
                this.unlockUI();
            } catch (e) {
                this.logout();
            }
        }
    },

    async login(e) {
        e.preventDefault();
        const user = document.getElementById('auth-user').value.trim();
        const pass = document.getElementById('auth-pass').value;
        const btn = document.getElementById('login-btn');
        const err = document.getElementById('auth-error');

        btn.disabled = true;
        const btnText = btn.querySelector('span');
        if (btnText) btnText.innerText = "Authenticating...";
        err.innerText = "";

        try {
            const res = await fetch(`/api/ops?mode=login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            }).then(r => r.json());

            if (res.error) throw new Error(res.error);

            this.session = { token: res.token, user: res.user };
            localStorage.setItem('brume_session', JSON.stringify(this.session));

            this.unlockUI();
            this.toast(`Authenticated as ${this.session.user.username}`);
        } catch (error) {
            err.innerText = error.message;
            btn.disabled = false;
            if (btnText) btnText.innerText = "Authenticate";
        }
    },

    logout() {
        localStorage.removeItem('brume_session');
        location.reload();
    },

    async req(mode, method = 'GET', body = null) {
        if (!this.session) return { error: "No active session" };

        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.session.token}`
            }
        };
        if (body) opts.body = JSON.stringify(body);

        try {
            const res = await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());
            if (res && res.error === "Session expired or invalid") {
                this.logout();
            }
            return res;
        } catch (err) {
            return { error: err.message };
        }
    },

    async unlockUI() {
        document.getElementById('auth-layer').style.display = 'none';
        document.getElementById('dashboard-layer').style.display = 'flex';

        document.getElementById('profile-name').innerText = this.session.user.username;
        document.getElementById('profile-role').innerText = this.session.user.role.toUpperCase();
        document.getElementById('profile-avatar').innerText = this.session.user.username.charAt(0).toUpperCase();

        const badge = document.getElementById('profile-role');
        badge.className = 'role-pill ' + this.session.user.role;

        this.applyRolePermissions();
        this.loadSettings();

        if (['admin', 'mod'].includes(this.session.user.role)) {
            this.refreshAll();
            this.startAutoRefresh();
        }

        if (this.session.user.role === 'admin') {
            this.loadStaff();
        }
    },

    applyRolePermissions() {
        const role = this.session.user.role;
        const links = document.querySelectorAll('.nav-item[data-roles]');
        let firstAvailableView = null;

        links.forEach(link => {
            const allowedRoles = link.getAttribute('data-roles').split(',');
            if (!allowedRoles.includes(role)) {
                link.style.display = 'none';
            } else if (!firstAvailableView) {
                const match = link.getAttribute('onclick')?.match(/'([^']+)'/);
                if (match) firstAvailableView = match[1];
            }
        });

        if (firstAvailableView) this.navigate(firstAvailableView);
    },

    navigate(viewId) {
        this.activeView = viewId;
        document.querySelectorAll('.view-page').forEach(e => e.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active');

        document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
        const activeNav = Array.from(document.querySelectorAll('.nav-item')).find(el => el.getAttribute('onclick')?.includes(`'${viewId}'`));
        if (activeNav) activeNav.classList.add('active');

        if (window.innerWidth <= 768) this.closeSidebar();

        if (viewId === 'overview') this.refreshAll();
        if (viewId === 'players') this.loadOnlinePlayers();
        if (viewId === 'bans') this.loadBans();
        if (viewId === 'logs') this.loadLogs();
        if (viewId === 'console') this.initConsole();
        if (viewId === 'analytics') this.loadAnalytics();
        if (viewId === 'staff') this.loadStaff();
        if (viewId === 'settings') this.renderSettingsUI();
        if (viewId === 'security') this.loadAlerts();
    },

    toast(msg, type = "success") {
        const c = document.getElementById('toast-container');
        if (!c) return;
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 3200);
    },

    // ══════════════════════════════════════════════════════════
    // 2. LIVE REFRESH & SYNC ENGINE
    // ══════════════════════════════════════════════════════════

    setRefreshRate(ms) {
        this.refreshIntervalMs = parseInt(ms);
        this.startAutoRefresh();
        this.toast(`Sync cadence updated: ${ms === '0' ? 'Manual only' : ms / 1000 + 's'}`);
    },

    startAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        if (this.refreshIntervalMs > 0) {
            this.refreshTimer = setInterval(() => {
                this.refreshActiveContext();
            }, this.refreshIntervalMs);
        }
    },

    manualRefresh() {
        this.refreshActiveContext();
        this.toast("Synchronized with server");
    },

    refreshAll() {
        this.loadStats();
        this.loadOverviewLogs();
        this.loadOnlinePlayers();
        this.req('analytics_economy&days=7').then(r => { if (!r.error) this.renderOverviewEcoChart(r); });
        this.req('analytics_retention').then(r => { if (!r.error) this.renderOverviewWeekStats(r); });
        this.req('alerts_list').then(r => { if (!r.error) this.updateAlertBadge(r.unresolved_count || 0); });
        this.req('analytics_leaderboard').then(r => {
            if (!r.error && r.totals) {
                const el = document.getElementById('ov-avg-session');
                if (el) el.innerText = this.fmtDuration(r.totals.avg_playtime_s);
                const sel = document.getElementById('ov-sessions');
                if (sel) sel.innerText = Number(r.totals.total_sessions || 0).toLocaleString();
            }
        });
    },

    refreshActiveContext() {
        if (this.activeView === 'overview') this.refreshAll();
        else if (this.activeView === 'players') this.loadOnlinePlayers();
        else if (this.activeView === 'security') this.loadAlerts();
        else if (this.activeView === 'logs') this.loadLogs();
        else if (this.activeView === 'bans') this.loadBans();
        else if (this.activeView === 'analytics') this.loadAnalytics();
    },

    // ══════════════════════════════════════════════════════════
    // 3. OVERVIEW METRICS
    // ══════════════════════════════════════════════════════════

    async loadStats() {
        const res = await this.req('stats');
        if (!res || res.error) return;
        const u = document.getElementById('stat-users');
        const e = document.getElementById('stat-eco');
        const r = document.getElementById('stat-rich');
        if (u) u.innerText = Number(res.user_count || 0).toLocaleString();
        if (e) e.innerText = this.fmtCoins(res.total_economy || 0) + ' ◎';
        if (r) r.innerText = res.top_player || 'None';
    },

    async loadOverviewLogs() {
        const container = document.getElementById('overview-logs-container');
        if (!container) return;
        const res = await this.req('logs');
        if (!res || res.error || !Array.isArray(res) || !res.length) {
            container.innerHTML = `<p class="text-muted" style="padding:16px 0;">No recent audit activity recorded.</p>`;
            return;
        }
        container.innerHTML = res.slice(0, 6).map(l => {
            const date = new Date(l.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-dim);">
                <span class="mono text-muted" style="font-size:11px;min-width:44px;">${date}</span>
                <span class="role-pill mod" style="font-size:10px;">${l.username}</span>
                <span style="font-size:12.5px;color:var(--text-secondary);flex:1;">${l.action}</span>
            </div>`;
        }).join('');
    },

    renderOverviewWeekStats(data) {
        const rows = data || [];
        const last = rows[rows.length - 1];
        if (!last) return;
        const n = document.getElementById('ov-new');
        const r = document.getElementById('ov-ret');
        if (n) n.innerText = Number(last.new_players || 0).toLocaleString();
        if (r) r.innerText = Number(last.returning_players || 0).toLocaleString();
    },

    renderOverviewEcoChart(data) {
        const snaps = (data.snapshots || []).filter(s => s.total_coins > 0).slice(-24);
        const ctx = document.getElementById('overview-eco-chart');
        if (!ctx || !snaps.length) return;

        if (this.charts['ov-eco']) this.charts['ov-eco'].destroy();

        const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 160);
        grad.addColorStop(0, 'rgba(91, 106, 255, 0.25)');
        grad.addColorStop(1, 'rgba(91, 106, 255, 0)');

        this.charts['ov-eco'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: snaps.map(() => ''),
                datasets: [{
                    data: snaps.map(s => s.total_coins),
                    borderColor: '#5b6aff',
                    backgroundColor: grad,
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.35
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } }
            }
        });
    },

    // ══════════════════════════════════════════════════════════
    // 4. PLAYER DIRECTORY & INSPECTOR
    // ══════════════════════════════════════════════════════════

    _playerData: null,
    _autocompleteTimer: null,
    _autocompleteIndex: -1,
    _playerChart: null,

    async playerSearchInput(val) {
        clearTimeout(this._autocompleteTimer);
        const box = document.getElementById('p-autocomplete');
        if (!val || val.length < 1) { box.style.display = 'none'; return; }

        this._autocompleteTimer = setTimeout(async () => {
            const res = await this.req(`player_autocomplete&q=${encodeURIComponent(val)}`);
            if (!res || res.error || !res.length) { box.style.display = 'none'; return; }
            this._autocompleteIndex = -1;
            box.style.display = 'block';
            box.innerHTML = res.map((p, i) => {
                const playtime = this.fmtDuration(p.total_playtime_s);
                const lastSeen = p.last_seen ? new Date(p.last_seen).toLocaleDateString('en-GB') : 'Never';
                return `<div class="autocomplete-item" data-index="${i}" data-name="${p.name}"
                    onmousedown="app.selectAutocomplete('${p.name}')"
                    style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-dim);">
                    <img src="https://crafatar.com/avatars/${p.uuid}?size=32&overlay" style="width:26px;height:26px;image-rendering:pixelated;border-radius:2px;" onerror="this.style.display='none'">
                    <div style="flex:1;">
                        <div style="font-weight:600;font-size:12.5px;color:var(--text-primary);">${p.name}</div>
                        <div class="mono text-muted" style="font-size:10px;">Lv.${p.level} · ${this.fmtCoins(p.coins)} ◎ · ${playtime}</div>
                    </div>
                    <span class="mono text-muted" style="font-size:10px;">${lastSeen}</span>
                </div>`;
            }).join('');
        }, 150);
    },

    playerSearchKeydown(e) {
        const box = document.getElementById('p-autocomplete');
        const items = box.querySelectorAll('.autocomplete-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._autocompleteIndex = Math.min(this._autocompleteIndex + 1, items.length - 1);
            items.forEach((el, i) => el.style.background = i === this._autocompleteIndex ? 'var(--bg-hover)' : '');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._autocompleteIndex = Math.max(this._autocompleteIndex - 1, 0);
            items.forEach((el, i) => el.style.background = i === this._autocompleteIndex ? 'var(--bg-hover)' : '');
        } else if (e.key === 'Enter') {
            if (this._autocompleteIndex >= 0 && items[this._autocompleteIndex]) {
                this.selectAutocomplete(items[this._autocompleteIndex].dataset.name);
            } else {
                this.loadPlayerDetail();
            }
        } else if (e.key === 'Escape') {
            box.style.display = 'none';
        }
    },

    selectAutocomplete(name) {
        document.getElementById('p-search').value = name;
        document.getElementById('p-autocomplete').style.display = 'none';
        this.loadPlayerDetail();
    },

    async loadPlayerDetail() {
        const q = document.getElementById('p-search').value.trim();
        if (!q) return;
        document.getElementById('p-autocomplete').style.display = 'none';

        const profile = document.getElementById('player-profile');
        profile.style.display = 'block';
        document.getElementById('player-name-hero').innerText = 'Loading...';
        document.getElementById('player-stat-grid').innerHTML = '';

        const res = await this.req('player_detail', 'POST', { query: q });
        if (res.error) {
            this.toast(res.error, 'error');
            profile.style.display = 'none';
            return;
        }

        this._playerData = res;
        this.renderPlayerDetail(res);
        this.loadInventoryInspector();
    },

    renderPlayerDetail(data) {
        const { player, stats, snapshots, sessions, punishments, ip_history, alt_accounts, security_alerts } = data;
        const fmtC = this.fmtCoins.bind(this);
        const fmtD = this.fmtDuration.bind(this);

        // Hero
        const uuid = player.uuid;
        document.getElementById('player-face').src = `https://crafatar.com/avatars/${uuid}?size=72&overlay`;
        document.getElementById('player-name-hero').innerText = player.name;
        document.getElementById('player-uuid-hero').innerText = uuid;

        const onlineDot = document.getElementById('player-online-dot');
        const onlineBadge = document.getElementById('player-online-badge');
        const banBadge = document.getElementById('player-ban-badge');
        onlineDot.style.display = player.is_online ? 'block' : 'none';
        onlineBadge.style.display = player.is_online ? 'inline-block' : 'none';

        const activeBan = punishments.find(p => (p.type === 'ban' || p.type === 'tempban') && p.active);
        banBadge.style.display = activeBan ? 'inline-block' : 'none';

        const firstSeen = player.first_seen ? new Date(player.first_seen).toLocaleDateString('en-GB') : 'Unknown';
        const lastSeen = player.last_seen ? new Date(player.last_seen).toLocaleString('en-GB', { hour12: false }) : 'Never';
        document.getElementById('player-first-seen').innerText = `First seen: ${firstSeen}`;
        document.getElementById('player-last-seen').innerText = `Last seen: ${lastSeen}`;
        
        const daysAgoEl = document.getElementById('player-days-ago');
        if (player.days_since_last_seen !== null) {
            const d = player.days_since_last_seen;
            daysAgoEl.innerText = player.is_online ? 'Online now' : d === 0 ? 'Active today' : `${d}d ago`;
            daysAgoEl.style.color = player.is_online ? 'var(--emerald)' : d <= 3 ? 'var(--text-secondary)' : 'var(--text-muted)';
        }

        // Rank tags
        const rankBadges = document.getElementById('player-rank-badges');
        const badges = [];
        if (stats.coin_percentile >= 90) badges.push({ label: `Top ${Math.max(1, 100 - stats.coin_percentile)}% Wealth`, col: 'var(--amber)', bg: 'var(--amber-dim)' });
        if (stats.playtime_percentile >= 90) badges.push({ label: `Top ${Math.max(1, 100 - stats.playtime_percentile)}% Playtime`, col: 'var(--emerald)', bg: 'var(--emerald-dim)' });
        if (stats.level_percentile >= 90) badges.push({ label: `Top ${Math.max(1, 100 - stats.level_percentile)}% Level`, col: 'var(--purple)', bg: 'var(--purple-dim)' });
        if (Object.keys(alt_accounts).length > 0) badges.push({ label: 'Shared Network / Alt Group', col: 'var(--red)', bg: 'var(--red-dim)' });
        if (security_alerts.filter(a => !a.resolved).length > 0) badges.push({ label: 'Security Flags Open', col: 'var(--red)', bg: 'var(--red-dim)' });

        rankBadges.innerHTML = badges.map(b =>
            `<span class="badge-status" style="background:${b.bg};color:${b.col};border:1px solid ${b.col}40;">${b.label}</span>`
        ).join('');

        // Mini metric cards
        const statItems = [
            { label: 'Coins', value: `${fmtC(player.coins)} ◎`, color: 'var(--amber)' },
            { label: 'Level', value: player.level || 1, color: 'var(--purple)' },
            { label: 'XP', value: Number(player.xp || 0).toLocaleString(), color: 'var(--accent)' },
            { label: 'Playtime', value: fmtD(player.total_playtime_s), color: 'var(--emerald)' },
            { label: 'Sessions', value: Number(player.session_count || 0).toLocaleString(), color: 'var(--text-primary)' },
            { label: 'Coins / Hour', value: `${fmtC(stats.coins_per_hour)} ◎`, color: 'var(--amber)' },
            { label: 'Avg Session', value: fmtD(stats.avg_session_s), color: 'var(--text-primary)' },
            { label: 'Sanctions', value: punishments.length, color: punishments.length > 0 ? 'var(--red)' : 'var(--emerald)' },
        ];
        document.getElementById('player-stat-grid').innerHTML = statItems.map(s =>
            `<div class="metric-card">
                <span class="metric-title">${s.label}</span>
                <div class="metric-value" style="color:${s.color};font-size:20px;margin-top:4px;">${s.value}</div>
            </div>`
        ).join('');

        // Wealth Intelligence
        const wealthEl = document.getElementById('player-wealth-analysis');
        const vsAvg = player.coins - stats.server_avg_coins;
        const vsAvgPct = stats.server_avg_coins > 0 ? Math.round((vsAvg / stats.server_avg_coins) * 100) : 0;
        wealthEl.innerHTML = [
            { label: 'Variance vs Mean', value: `${vsAvg >= 0 ? '+' : ''}${fmtC(vsAvg)} ◎`, color: vsAvg >= 0 ? 'var(--emerald)' : 'var(--red)' },
            { label: 'Variance Percentage', value: `${vsAvgPct >= 0 ? '+' : ''}${vsAvgPct}%`, color: vsAvgPct >= 0 ? 'var(--emerald)' : 'var(--red)' },
            { label: 'Server Mean Wallet', value: `${fmtC(stats.server_avg_coins)} ◎`, color: 'var(--text-secondary)' },
            { label: '7-Day Trend', value: stats.wealth_trend_pct !== null ? `${stats.wealth_trend_pct >= 0 ? '+' : ''}${stats.wealth_trend_pct}%` : 'Stable', color: stats.wealth_trend_pct > 0 ? 'var(--emerald)' : stats.wealth_trend_pct < 0 ? 'var(--red)' : 'var(--text-muted)' },
        ].map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-dim);">
            <span style="font-size:11.5px;color:var(--text-muted);">${r.label}</span>
            <span class="mono" style="font-size:12px;font-weight:600;color:${r.color};">${r.value}</span>
        </div>`).join('');

        // Percentiles
        const ranksEl = document.getElementById('player-ranks');
        const mkRank = (label, rank, total, pct) => {
            const barW = Math.max(3, pct);
            return `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px;">
                    <span style="color:var(--text-muted);">${label}</span>
                    <span class="mono" style="color:var(--text-primary);font-weight:600;">#${rank} <span class="text-muted">/ ${total}</span></span>
                </div>
                <div style="height:4px;background:var(--bg-raised);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${barW}%;background:var(--accent);border-radius:2px;transition:width 0.4s ease;"></div>
                </div>
            </div>`;
        };
        const tot = stats.total_players;
        ranksEl.innerHTML =
            mkRank('Coin Balance', stats.coin_rank, tot, stats.coin_percentile) +
            mkRank('Player Level', stats.level_rank, tot, stats.level_percentile) +
            mkRank('Cumulative Playtime', stats.playtime_rank, tot, stats.playtime_percentile);

        // Activity Health
        const actEl = document.getElementById('player-activity');
        const vsAvgPlay = (player.total_playtime_s || 0) - stats.server_avg_playtime;
        actEl.innerHTML = [
            { label: 'Recorded Playtime', value: fmtD(player.total_playtime_s), color: 'var(--emerald)' },
            { label: 'Variance vs Mean', value: `${vsAvgPlay >= 0 ? '+' : ''}${fmtD(Math.abs(vsAvgPlay))}`, color: vsAvgPlay >= 0 ? 'var(--emerald)' : 'var(--red)' },
            { label: 'Mean Session Length', value: fmtD(stats.avg_session_s), color: 'var(--text-secondary)' },
            { label: 'Cumulative Sessions', value: Number(player.session_count || 0).toLocaleString(), color: 'var(--text-secondary)' },
        ].map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-dim);">
            <span style="font-size:11.5px;color:var(--text-muted);">${r.label}</span>
            <span class="mono" style="font-size:12px;font-weight:600;color:${r.color};">${r.value}</span>
        </div>`).join('');

        // Valuation trajectory chart
        if (this._playerChart) { this._playerChart.destroy(); this._playerChart = null; }
        const chartContainer = document.getElementById('player-coin-chart');
        if (snapshots.length > 1 && chartContainer) {
            const ctx = chartContainer.getContext('2d');
            const grad = ctx.createLinearGradient(0, 0, 0, 160);
            grad.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
            grad.addColorStop(1, 'rgba(245, 158, 11, 0)');

            this._playerChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: snapshots.map(s => new Date(s.snapped_at).toLocaleDateString('en-GB')),
                    datasets: [{
                        data: snapshots.map(s => s.coins),
                        borderColor: '#f59e0b',
                        backgroundColor: grad,
                        borderWidth: 2,
                        pointRadius: snapshots.length > 30 ? 0 : 3,
                        pointBackgroundColor: '#f59e0b',
                        fill: true,
                        tension: 0.3,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: '#12131a',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: { label: ctx => ` ${Number(ctx.raw).toLocaleString()} ◎` }
                        }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6a6a82', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 } },
                        y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6a6a82', font: { family: 'JetBrains Mono', size: 10 }, callback: v => fmtC(v) } }
                    }
                }
            });
        }

        // Sessions list
        const sessEl = document.getElementById('player-sessions-list');
        if (!sessions.length) {
            sessEl.innerHTML = `<p class="text-muted" style="padding:8px 0;">No sessions on record.</p>`;
        } else {
            sessEl.innerHTML = sessions.map(s => {
                const date = new Date(s.joined_at).toLocaleString('en-GB', { hour12: false });
                const dur = s.duration_s ? fmtD(s.duration_s) : 'Active now';
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border-dim);">
                    <span class="mono text-muted" style="font-size:11px;">${date}</span>
                    <span class="mono" style="font-size:11px;font-weight:600;color:${s.duration_s ? 'var(--text-secondary)' : 'var(--emerald)'};">${dur}</span>
                </div>`;
            }).join('');
        }

        // Punishments list
        const punEl = document.getElementById('player-punishments-list');
        if (!punishments.length) {
            punEl.innerHTML = `<p class="text-green" style="padding:8px 0;font-size:12px;">✓ Clean disciplinary record.</p>`;
        } else {
            punEl.innerHTML = punishments.map(p => {
                const date = new Date(p.issued_at).toLocaleDateString('en-GB');
                return `<div style="padding:8px 0;border-bottom:1px solid var(--border-dim);">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                        <span class="badge-status ${p.type === 'ban' ? 'banned' : 'online'}">${p.type.toUpperCase()}</span>
                        ${!p.active ? '<span class="text-muted" style="font-size:10px;">REVOKED</span>' : ''}
                        <span class="mono text-muted" style="font-size:10px;margin-left:auto;">${date}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);">${p.reason}</div>
                    <div class="text-muted" style="font-size:10px;margin-top:2px;">Issued by ${p.issued_by}</div>
                </div>`;
            }).join('');
        }

        // IP fingerprints
        const ipEl = document.getElementById('player-ip-list');
        if (!ip_history.length) {
            ipEl.innerHTML = `<p class="text-muted" style="padding:8px 0;">No IP network records.</p>`;
        } else {
            ipEl.innerHTML = ip_history.map(ip => {
                const masked = ip.ip.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*');
                const alts = alt_accounts[ip.ip] || [];
                const lastSeen = new Date(ip.last_seen).toLocaleDateString('en-GB');
                return `<div style="padding:8px 0;border-bottom:1px solid var(--border-dim);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                        <span class="mono" style="font-size:11.5px;font-weight:600;">${masked}</span>
                        <span class="text-muted" style="font-size:10px;">${ip.times}× · ${lastSeen}</span>
                    </div>
                    ${alts.length ? `<div style="font-size:11px;color:var(--red);">Shared with: ${alts.map(a => `<span class="btn-link" onclick="app.selectAutocomplete('${a.name}')">${a.name}</span>`).join(', ')}</div>` : ''}
                </div>`;
            }).join('');
        }

        // Security Alerts list
        const secEl = document.getElementById('player-security-list');
        if (!security_alerts.length) {
            secEl.innerHTML = `<p class="text-green" style="padding:8px 0;font-size:12px;">✓ No security flags recorded.</p>`;
        } else {
            secEl.innerHTML = security_alerts.map(a => {
                const date = new Date(a.created_at).toLocaleDateString('en-GB');
                return `<div style="padding:8px 0;border-bottom:1px solid var(--border-dim);">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                        <span class="badge-status banned">${a.type}</span>
                        ${a.resolved ? '<span class="text-green" style="font-size:10px;">RESOLVED</span>' : ''}
                        <span class="mono text-muted" style="font-size:10px;margin-left:auto;">${date}</span>
                    </div>
                    <div style="font-size:11.5px;color:var(--text-secondary);">${a.detail}</div>
                </div>`;
            }).join('');
        }

        // Populate edit form
        document.getElementById('val-uuid').value = player.uuid;
        document.getElementById('val-name').innerText = player.name;
        document.getElementById('inp-coins').value = player.coins || 0;
        document.getElementById('inp-level').value = player.level || 1;
    },

    showPlayerEdit() {
        const panel = document.getElementById('player-edit-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        if (panel.style.display === 'block') panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    async savePlayer() {
        const body = {
            uuid: document.getElementById('val-uuid').value,
            name: document.getElementById('val-name').innerText,
            coins: document.getElementById('inp-coins').value,
            level: document.getElementById('inp-level').value
        };
        const res = await this.req('update', 'POST', body);
        if (res.error) this.toast(res.error, "error");
        else {
            this.toast("Player profile updated");
            document.getElementById('player-edit-panel').style.display = 'none';
            this.loadPlayerDetail();
            this.loadLogs();
            this.loadStats();
        }
    },

    // ══════════════════════════════════════════════════════════
    // 5. INVENTORY & VAULT INSPECTOR
    // ══════════════════════════════════════════════════════════

    _invData: null,
    _vaultData: null,
    _currentVaultPage: 0,

    async loadInventoryInspector() {
        const name = document.getElementById('p-search').value.trim();
        if (!name) return;
        const res = await this.req('player_inventory', 'POST', { name });
        if (res.error) return this.toast(res.error, 'error');
        this._invData = res.inventory;
        this._vaultData = res.vault || [];
        this.renderInventoryTab();
        this.renderVaultTab();
        if (res.inventory) {
            const t = new Date(res.inventory.snapped_at).toLocaleString('en-GB', { hour12: false });
            const snapEl = document.getElementById('inv-snapshot-time');
            if (snapEl) snapEl.innerText = `Latest Snapshot: ${t}`;
        }
    },

    setInvTab(tab, btn) {
        ['inventory', 'vault', 'timeline'].forEach(t => {
            const el = document.getElementById(`inv-tab-${t}`);
            if (el) el.style.display = t === tab ? 'block' : 'none';
        });
        document.querySelectorAll('.tab-strip .tab-pill').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (tab === 'timeline') this.loadInvTimeline();
    },

    mcToHtml(text) {
        if (!text) return '';
        const MC_COLORS = {
            '0':'#000000','1':'#0000aa','2':'#00aa00','3':'#00aaaa',
            '4':'#aa0000','5':'#aa00aa','6':'#ffaa00','7':'#aaaaaa',
            '8':'#555555','9':'#5555ff','a':'#55ff55','b':'#55ffff',
            'c':'#ff5555','d':'#ff55ff','e':'#ffff55','f':'#ffffff'
        };
        let html = '', i = 0, color = '#ffffff', bold = false, italic = false;
        while (i < text.length) {
            const hex = text.slice(i).match(/^<#([0-9a-fA-F]{6})>/);
            if (hex) { color = '#' + hex[1]; bold = false; italic = false; i += hex[0].length; continue; }
            if (text[i] === '&' && i + 1 < text.length) {
                const c = text[i+1].toLowerCase();
                if (MC_COLORS[c]) { color = MC_COLORS[c]; bold = false; italic = false; i += 2; continue; }
                if (c === 'l') { bold = true; i += 2; continue; }
                if (c === 'o') { italic = true; i += 2; continue; }
                if (c === 'r') { color = '#ffffff'; bold = false; italic = false; i += 2; continue; }
            }
            const ch = text[i] === ' ' ? '&nbsp;' : text[i].replace(/</g,'&lt;').replace(/>/g,'&gt;');
            let style = `color:${color};`;
            if (bold) style += 'font-weight:bold;';
            if (italic) style += 'font-style:italic;';
            html += `<span style="${style}">${ch}</span>`;
            i++;
        }
        return html;
    },

    buildTooltip(item) {
        if (!item) return null;
        let html = '';
        const nameColor = item.primary ? item.primary : (item.tier === 'COMMON' ? '&f' : item.tier === 'UNCOMMON' ? '&a' : item.tier === 'RARE' ? '&9' : item.tier === 'EPIC' ? '&5' : '&6');
        const displayName = item.name || item.id?.replace(/_/g, ' ') || 'Item';
        html += `<div style="font-weight:bold;margin-bottom:4px;">${this.mcToHtml(nameColor + '&l' + displayName)}</div>`;

        if (item.lore?.length) {
            item.lore.forEach(line => {
                html += line ? `<div>${this.mcToHtml(line)}</div>` : `<div style="height:4px;"></div>`;
            });
        }

        if (item.tier) {
            const TIER_COLORS = { COMMON:'&f', UNCOMMON:'&a', RARE:'&9', EPIC:'&5', LEGENDARY:'&6' };
            const tc = TIER_COLORS[item.tier] || '&f';
            html += `<div style="margin-top:6px;font-weight:bold;">${this.mcToHtml(`${tc}&l${item.tier}`)}</div>`;
        }
        return html;
    },

    makeSlot(item, extraClass = '') {
        const slot = document.createElement('div');
        if (!item) {
            slot.className = `inv-slot empty ${extraClass}`;
            return slot;
        }
        slot.className = `inv-slot ${extraClass}`;

        const mat = (item.material || item.id || 'air').toLowerCase().replace(/ /g, '_');
        const img = document.createElement('img');
        img.src = `https://mc-heads.net/item/${mat}`;
        img.alt = item.name || mat;
        img.onerror = () => { img.style.display = 'none'; };
        slot.appendChild(img);

        if (item.amount > 1) {
            const amt = document.createElement('span');
            amt.className = 'slot-amount';
            amt.innerText = item.amount;
            slot.appendChild(amt);
        }

        const tooltip = document.getElementById('inv-tooltip');
        const tooltipHtml = this.buildTooltip(item);
        if (tooltipHtml) {
            slot.addEventListener('mouseenter', e => {
                tooltip.innerHTML = tooltipHtml;
                tooltip.style.display = 'block';
                this.positionTooltip(e);
            });
            slot.addEventListener('mousemove', e => this.positionTooltip(e));
            slot.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
        }
        return slot;
    },

    positionTooltip(e) {
        const tooltip = document.getElementById('inv-tooltip');
        const x = e.clientX + 14;
        const y = e.clientY + 10;
        const maxX = window.innerWidth - tooltip.offsetWidth - 12;
        const maxY = window.innerHeight - tooltip.offsetHeight - 12;
        tooltip.style.left = Math.min(x, maxX) + 'px';
        tooltip.style.top  = Math.min(y, maxY) + 'px';
    },

    renderInventoryTab() {
        const emptyMsg = document.getElementById('inv-empty-msg');
        const hotbarGrid = document.getElementById('inv-hotbar-grid');
        const mainGrid = document.getElementById('inv-main-grid');
        const armorGrid = document.getElementById('inv-armor-grid');
        const offhandEl = document.getElementById('inv-offhand-slot');

        hotbarGrid.innerHTML = '';
        mainGrid.innerHTML = '';
        armorGrid.innerHTML = '';
        offhandEl.innerHTML = '';

        if (!this._invData) {
            emptyMsg.style.display = 'block';
            return;
        }
        emptyMsg.style.display = 'none';

        const slots = this._invData.slots || [];
        const armor = this._invData.armor || [];

        for (let i = 0; i < 9; i++) hotbarGrid.appendChild(this.makeSlot(slots[i] ?? null));
        for (let i = 9; i < 36; i++) mainGrid.appendChild(this.makeSlot(slots[i] ?? null));
        for (let i = 0; i < 4; i++) armorGrid.appendChild(this.makeSlot(armor[i] ?? null));
        offhandEl.appendChild(this.makeSlot(this._invData.offhand ?? null));
    },

    renderVaultTab() {
        const tabsEl = document.getElementById('vault-page-tabs');
        const gridEl = document.getElementById('vault-grid');
        const emptyEl = document.getElementById('vault-empty-msg');

        if (!this._vaultData?.length) {
            emptyEl.style.display = 'block';
            gridEl.style.display = 'none';
            tabsEl.innerHTML = '';
            return;
        }
        emptyEl.style.display = 'none';
        gridEl.style.display = 'grid';

        tabsEl.innerHTML = this._vaultData.map((v, i) =>
            `<button class="btn-ghost sm ${i === 0 ? 'active' : ''}" onclick="app.showVaultPage(${i},this)">Vault ${v.page}</button>`
        ).join('');

        this.showVaultPage(0);
    },

    showVaultPage(idx, btn) {
        this._currentVaultPage = idx;
        document.querySelectorAll('#vault-page-tabs button').forEach((b, i) => b.classList.toggle('active', i === idx));
        const page = this._vaultData[idx];
        const gridEl = document.getElementById('vault-grid');
        gridEl.innerHTML = '';
        const slots = page?.slots || [];
        for (let i = 0; i < 45; i++) gridEl.appendChild(this.makeSlot(slots[i] ?? null));
    },

    async loadInvTimeline() {
        const name = document.getElementById('p-search').value.trim();
        if (!name) return;
        const res = await this.req('inventory_timeline', 'POST', { name });
        const el = document.getElementById('inv-timeline-list');
        if (!res?.length) {
            el.innerHTML = `<p class="text-muted" style="padding:16px 0;">No snapshot timeline entries recorded.</p>`;
            return;
        }
        el.innerHTML = res.map(s => {
            const date = new Date(s.snapped_at).toLocaleString('en-GB', { hour12: false });
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-dim);">
                <div>
                    <div class="mono" style="font-size:11.5px;font-weight:600;">${date}</div>
                    <div class="text-muted" style="font-size:10px;text-transform:uppercase;">Trigger: ${s.trigger_type}</div>
                </div>
                <button class="btn-ghost sm" onclick="app.loadInvSnapshot(${s.id})">Load Snapshot</button>
            </div>`;
        }).join('');
    },

    async loadInvSnapshot(id) {
        const res = await this.req('inventory_snapshot_detail', 'POST', { id });
        if (res.error) return this.toast(res.error, 'error');
        this._invData = res;
        this.setInvTab('inventory', document.querySelectorAll('.tab-strip .tab-pill')[0]);
        this.renderInventoryTab();
        const t = new Date(res.snapped_at).toLocaleString('en-GB', { hour12: false });
        this.toast(`Loaded snapshot from ${t}`);
    },

    // ══════════════════════════════════════════════════════════
    // 6. ONLINE PLAYERS & MODERATION
    // ══════════════════════════════════════════════════════════

    async loadOnlinePlayers() {
        const res = await this.req('online_players');
        const countBadge = document.getElementById('online-count-badge');
        const sideCount = document.getElementById('sidebar-online-count');
        const container = document.getElementById('online-players-container');

        const players = Array.isArray(res) ? res : [];
        if (countBadge) countBadge.innerText = `${players.length} Online`;
        if (sideCount) sideCount.innerText = players.length;

        if (!container) return;

        if (!players.length) {
            container.innerHTML = `<p class="text-muted" style="padding:24px;">No players currently connected.</p>`;
            return;
        }

        container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>UUID</th>
                    <th>Level</th>
                    <th>Wallet Balance</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${players.map(p => `
                    <tr>
                        <td style="font-weight:600;color:var(--text-primary);">
                            <span class="btn-link" onclick="app.openProfileModal('${p.name}')">${p.name}</span>
                        </td>
                        <td class="mono text-muted" style="font-size:11px;">${p.uuid ? p.uuid.substring(0, 13) + '...' : '—'}</td>
                        <td><span class="role-pill" style="background:var(--purple-dim);color:var(--purple);">Lv.${p.level || 1}</span></td>
                        <td class="mono text-gold">${Number(p.coins || 0).toLocaleString()} ◎</td>
                        <td>
                            <div class="btn-row">
                                <button class="btn-ghost sm" onclick="app.quickWarn('${p.name}')">Warn</button>
                                <button class="btn-danger-ghost sm" onclick="app.quickBan('${p.name}')">Sanction</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    },

    quickBan(name) {
        document.getElementById('ban-target').value = name;
        document.getElementById('ban-type').value = 'ban';
        this.toggleDuration();
        this.navigate('bans');
    },

    quickWarn(name) {
        document.getElementById('ban-target').value = name;
        document.getElementById('ban-type').value = 'warn';
        this.toggleDuration();
        this.navigate('bans');
    },

    toggleDuration() {
        const type = document.getElementById('ban-type').value;
        const group = document.getElementById('duration-group');
        if (group) {
            group.style.opacity = type === 'tempban' ? '1' : '0.3';
            group.style.pointerEvents = type === 'tempban' ? 'auto' : 'none';
        }
    },

    async issuePunishment() {
        const target = document.getElementById('ban-target').value.trim();
        const type = document.getElementById('ban-type').value;
        const reason = document.getElementById('ban-reason').value.trim();
        const duration = document.getElementById('ban-duration').value.trim();

        if (!target || !reason) return this.toast("Target player and reason required", "error");

        const res = await this.req('punish', 'POST', { target, type, reason, duration });
        if (res.error) return this.toast(res.error, "error");

        this.toast(`Sanction issued against ${target}`);
        document.getElementById('ban-target').value = '';
        document.getElementById('ban-reason').value = '';
        this.loadBans();
        this.loadLogs();
    },

    async loadBans() {
        const res = await this.req('bans_list');
        const container = document.getElementById('bans-table-container');
        if (!container) return;

        if (res.error) {
            container.innerHTML = `<p class="text-danger" style="padding:20px;">Error: ${res.error}</p>`;
            return;
        }

        if (!res.length) {
            container.innerHTML = `<p class="text-muted" style="padding:24px;">No active sanctions.</p>`;
            return;
        }

        container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Issued By</th>
                    <th>Date</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${res.map(b => `
                    <tr>
                        <td style="font-weight:600;color:var(--text-primary);">${b.target_name}</td>
                        <td><span class="badge-status ${b.type === 'ban' ? 'banned' : 'online'}">${b.type.toUpperCase()}${b.duration ? ' ('+b.duration+')' : ''}</span></td>
                        <td style="color:var(--text-secondary);max-width:240px;">${b.reason}</td>
                        <td class="mono text-muted">${b.issued_by}</td>
                        <td class="mono text-muted">${new Date(b.issued_at).toLocaleDateString('en-GB')}</td>
                        <td><button class="btn-ghost sm" onclick="app.revokePunishment(${b.id})">Revoke</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    },

    async revokePunishment(id) {
        const res = await this.req('revoke', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Sanction revoked");
        this.loadBans();
        this.loadLogs();
    },

    // ══════════════════════════════════════════════════════════
    // 7. AUDIT TRAIL
    // ══════════════════════════════════════════════════════════

    async loadLogs() {
        const res = await this.req('logs');
        const container = document.getElementById('logs-table-container');
        if (!container) return;

        if (res.error) {
            container.innerHTML = `<p class="text-danger" style="padding:20px;">Error: ${res.error}</p>`;
            return;
        }

        if (!res.length) {
            container.innerHTML = `<p class="text-muted" style="padding:24px;">No log entries found.</p>`;
            return;
        }

        container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>Staff Member</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${res.map(l => `
                    <tr>
                        <td class="mono text-muted" style="font-size:11px;white-space:nowrap;">${new Date(l.timestamp).toLocaleString('en-GB', { hour12: false })}</td>
                        <td><span class="role-pill mod">${l.username}</span></td>
                        <td style="color:var(--text-primary);">${l.action}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    },

    // ══════════════════════════════════════════════════════════
    // 8. SERVER TERMINAL (RCON)
    // ══════════════════════════════════════════════════════════

    _cmdHistory: [],
    _historyIndex: -1,

    initConsole() {
        const out = document.getElementById('console-output');
        if (out && !out.innerHTML) {
            out.innerHTML = `<div class="text-muted">RCON interactive session ready. Commands dispatched directly to engine.</div>`;
        }
        const input = document.getElementById('console-input');
        if (input && !input.dataset.bound) {
            input.dataset.bound = 'true';
            input.addEventListener('keydown', e => {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (this._historyIndex < this._cmdHistory.length - 1) {
                        this._historyIndex++;
                        input.value = this._cmdHistory[this._cmdHistory.length - 1 - this._historyIndex];
                    }
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (this._historyIndex > 0) {
                        this._historyIndex--;
                        input.value = this._cmdHistory[this._cmdHistory.length - 1 - this._historyIndex];
                    } else {
                        this._historyIndex = -1;
                        input.value = '';
                    }
                }
            });
        }
    },

    consoleLog(text, isErr = false) {
        const out = document.getElementById('console-output');
        if (!out) return;
        const line = document.createElement('div');
        line.style.color = isErr ? 'var(--red)' : 'var(--text-secondary)';
        line.innerHTML = text;
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
    },

    async runCommand() {
        const input = document.getElementById('console-input');
        const cmd = input.value.trim();
        if (!cmd) return;

        this._cmdHistory.push(cmd);
        this._historyIndex = -1;
        input.value = '';

        this.consoleLog(`<span style="color:var(--accent);font-weight:600;">&gt; ${this.escapeHtml(cmd)}</span>`);

        const res = await this.req('console', 'POST', { command: cmd });
        if (res.error) {
            this.consoleLog(`Error: ${this.escapeHtml(res.error)}`, true);
        } else {
            const lines = (res.output || '(no output)').split('\n');
            lines.forEach(l => this.consoleLog(this.escapeHtml(l)));
        }
    },

    clearConsole() {
        const out = document.getElementById('console-output');
        if (out) out.innerHTML = `<div class="text-muted">Terminal cleared.</div>`;
    },

    escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    },

    // ══════════════════════════════════════════════════════════
    // 9. SECURITY RADAR & ROLLBACK
    // ══════════════════════════════════════════════════════════

    _secTab: 'alerts',

    setSecTab(tab, btn) {
        this._secTab = tab;
        ['alerts','analysis','rollback','settings-sec'].forEach(t => {
            const el = document.getElementById(`sec-${t}`);
            if (el) el.style.display = t === tab ? 'block' : 'none';
        });
        document.querySelectorAll('#view-security .tab-strip .tab-pill').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (tab === 'alerts') this.loadAlerts();
        if (tab === 'analysis') this.loadAnalysis();
    },

    async loadAlerts() {
        const showResolved = document.getElementById('show-resolved')?.checked;
        const res = await this.req(`alerts_list${showResolved ? '&resolved=true' : ''}`);
        const container = document.getElementById('alerts-container');
        if (!container) return;

        this.updateAlertBadge(res.unresolved_count || 0);

        if (res.error) {
            container.innerHTML = `<p class="text-danger" style="padding:20px;">Error: ${res.error}</p>`;
            return;
        }

        if (!res.alerts?.length) {
            container.innerHTML = `<div class="panel-card" style="text-align:center;padding:36px;"><p class="text-green">✓ All clear. No ${showResolved ? '' : 'unresolved '}security flags.</p></div>`;
            return;
        }

        container.innerHTML = res.alerts.map(a => {
            const date = new Date(a.created_at).toLocaleString('en-GB', { hour12: false });
            return `<div class="panel-card" style="margin-bottom:12px;${a.resolved ? 'opacity:0.6;' : ''}">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
                    <div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                            <span class="badge-status banned">${a.type}</span>
                            <span class="role-pill admin">${a.severity.toUpperCase()}</span>
                            <span style="font-weight:600;font-size:13px;">${a.player_name}</span>
                            ${a.resolved ? '<span class="text-green" style="font-size:10px;">RESOLVED</span>' : ''}
                        </div>
                        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">${a.detail}</p>
                        <span class="mono text-muted" style="font-size:10.5px;">${date}</span>
                    </div>
                    ${!a.resolved ? `
                    <div class="btn-row">
                        <button class="btn-ghost sm" onclick="app.resolveAlert(${a.id})">Resolve</button>
                        ${a.player_name !== 'SERVER' ? `<button class="btn-ghost sm" onclick="app.quickRollback('${a.player_name}')">Rollback</button>` : ''}
                    </div>` : ''}
                </div>
            </div>`;
        }).join('');
    },

    updateAlertBadge(count) {
        const badge = document.getElementById('alert-badge');
        if (!badge) return;
        if (count > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = count;
        } else {
            badge.style.display = 'none';
        }
    },

    async resolveAlert(id) {
        const res = await this.req('alert_resolve', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Alert marked resolved");
        this.loadAlerts();
    },

    async resolveAllAlerts() {
        const ok = await this.confirm('Resolve all open security alerts?');
        if (!ok) return;
        const res = await this.req('alerts_resolve_all', 'POST', {});
        if (res.error) return this.toast(res.error, "error");
        this.toast("All alerts resolved");
        this.loadAlerts();
    },

    async loadAnalysis() {
        const container = document.getElementById('analysis-container');
        if (!container) return;
        container.innerHTML = `<p class="text-muted">Running heuristic analysis across snapshots...</p>`;

        const res = await this.req('security_analysis');
        if (res.error) {
            container.innerHTML = `<p class="text-danger">Error: ${res.error}</p>`;
            return;
        }

        const fmtC = this.fmtCoins.bind(this);
        let html = '';

        // Jumps
        html += `<div class="panel-card table-panel" style="margin-bottom:16px;">
            <div class="panel-card-header"><h4>Single-Snapshot Wallet Jumps (>10K ◎)</h4></div>`;
        if (!res.deltas?.length) html += `<p class="text-green" style="padding:16px 20px;">✓ No abnormal coin jumps detected.</p>`;
        else {
            html += `<table class="data-table"><thead><tr><th>Player</th><th>Prior</th><th>After</th><th>Delta</th><th>Timestamp</th><th>Action</th></tr></thead><tbody>`;
            res.deltas.forEach(d => {
                html += `<tr>
                    <td style="font-weight:600;"><span class="btn-link" onclick="app.openProfileModal('${d.name}')">${d.name}</span></td>
                    <td class="mono text-muted">${fmtC(d.prev_coins)} ◎</td>
                    <td class="mono text-primary">${fmtC(d.current_coins)} ◎</td>
                    <td class="mono text-gold">+${fmtC(d.delta)} ◎</td>
                    <td class="mono text-muted">${new Date(d.snapped_at).toLocaleDateString('en-GB')}</td>
                    <td><button class="btn-ghost sm" onclick="app.quickRollback('${d.name}')">Rollback</button></td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
        html += `</div>`;

        // Alts
        html += `<div class="panel-card table-panel" style="margin-bottom:16px;">
            <div class="panel-card-header"><h4>Shared Network IP Clusters</h4></div>`;
        if (!res.alts?.length) html += `<p class="text-green" style="padding:16px 20px;">✓ No multi-account IP clusters detected.</p>`;
        else {
            html += `<table class="data-table"><thead><tr><th>IP Address</th><th>Accounts</th><th>Identities</th><th>Last Active</th></tr></thead><tbody>`;
            res.alts.forEach(a => {
                const names = a.names.split(', ').map(n => `<span class="btn-link" onclick="app.openProfileModal('${n}')">${n}</span>`).join(', ');
                html += `<tr>
                    <td class="mono text-muted">${a.ip.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.*.*')}</td>
                    <td><span class="role-pill admin">${a.account_count}</span></td>
                    <td>${names}</td>
                    <td class="mono text-muted">${new Date(a.last_seen).toLocaleDateString('en-GB')}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
        }
        html += `</div>`;

        container.innerHTML = html;
    },

    quickRollback(name) {
        this.setSecTab('rollback', document.querySelectorAll('#view-security .tab-strip .tab-pill')[2]);
        document.getElementById('rollback-search').value = name;
        this.loadRollbackTimeline();
    },

    async loadRollbackTimeline() {
        const name = document.getElementById('rollback-search').value.trim();
        if (!name) return;
        const container = document.getElementById('rollback-container');
        container.innerHTML = `<p class="text-muted">Loading historical state points...</p>`;

        const res = await this.req('rollback_timeline', 'POST', { name });
        if (res.error) {
            container.innerHTML = `<p class="text-danger">Error: ${res.error}</p>`;
            return;
        }

        const { player, snapshots, inv_snapshots } = res;
        const fmtC = this.fmtCoins.bind(this);
        const fmtD = this.fmtDuration.bind(this);

        const findClosestInv = (snapDate) => {
            if (!inv_snapshots?.length) return null;
            const t = new Date(snapDate).getTime();
            let closest = null, minDiff = Infinity;
            inv_snapshots.forEach(s => {
                const diff = Math.abs(new Date(s.snapped_at).getTime() - t);
                if (diff < minDiff && diff < 3600000) { minDiff = diff; closest = s; }
            });
            return closest;
        };

        let html = `
        <div class="panel-card table-panel">
            <div class="panel-card-header">
                <div>
                    <h4>State History — ${player.name}</h4>
                    <p class="card-subtitle">Current: ${fmtC(player.coins)} ◎ · Lv.${player.level} · ${fmtD(player.total_playtime_s)}</p>
                </div>
            </div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Checkpoint</th>
                        <th>Wallet</th>
                        <th>Level &amp; XP</th>
                        <th>Inventory</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>`;

        snapshots.forEach((snap, i) => {
            const date = new Date(snap.snapped_at).toLocaleString('en-GB', { hour12: false });
            const closestInv = findClosestInv(snap.snapped_at);
            const isCurrent = i === 0;

            html += `<tr>
                <td class="mono text-muted">${date} ${isCurrent ? '<span class="role-pill mod" style="margin-left:6px;">LATEST</span>' : ''}</td>
                <td class="mono text-gold">${fmtC(snap.coins)} ◎</td>
                <td class="mono">Lv.${snap.level} (${Number(snap.xp).toLocaleString()} XP)</td>
                <td>${closestInv ? '<span class="role-pill">INV CAPTURED</span>' : '<span class="text-muted">—</span>'}</td>
                <td>
                    ${!isCurrent ? `
                    <div class="btn-row">
                        ${closestInv ? `<button class="btn-ghost sm" onclick="app.executeRollback(${snap.id},'${player.name}',${snap.coins},${snap.level},${closestInv.id})">Restore + Inv</button>` : ''}
                        <button class="btn-danger-ghost sm" onclick="app.executeRollback(${snap.id},'${player.name}',${snap.coins},${snap.level})">Restore Stats</button>
                    </div>` : '<span class="text-muted">Current</span>'}
                </td>
            </tr>`;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;
    },

    async executeRollback(snapshotId, name, coins, level, invSnapshotId = null) {
        const hasInv = invSnapshotId !== null;
        const ok = await this.confirm(`Roll back ${name} to ${this.fmtCoins(coins)} coins and Level ${level}?${hasInv ? '\nIncludes inventory recovery.' : ''}`);
        if (!ok) return;

        const res = await this.req('rollback_execute', 'POST', {
            snapshot_id: snapshotId,
            name,
            inv_snapshot_id: invSnapshotId
        });
        if (res.error) return this.toast(res.error, "error");

        this.toast(`Player ${name} rolled back successfully`);
        this.loadRollbackTimeline();
        this.loadLogs();
    },

    async saveWebhook() {
        const url = document.getElementById('webhook-url').value.trim();
        if (!url) return this.toast("Webhook URL is empty", "error");
        localStorage.setItem('brume_webhook', url);
        this.toast("Webhook configuration saved");
    },

    async testWebhook() {
        const url = document.getElementById('webhook-url').value.trim() || localStorage.getItem('brume_webhook');
        if (!url) return this.toast("Configure a webhook URL first", "error");
        const res = await this.req('test_webhook', 'POST', { webhook_url: url });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Test dispatch delivered to Discord");
    },

    // ══════════════════════════════════════════════════════════
    // 10. ECONOMY & GROWTH ANALYTICS
    // ══════════════════════════════════════════════════════════

    _analyticsDays: 7,

    setAnalyticsRange(days, btn) {
        this._analyticsDays = days;
        document.querySelectorAll('.time-range-group .range-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        this.loadAnalytics();
    },

    async loadAnalytics() {
        const [ecoRes, heatRes, retRes, lbRes] = await Promise.all([
            this.req(`analytics_economy&days=${this._analyticsDays}`),
            this.req('analytics_heatmap'),
            this.req('analytics_retention'),
            this.req('analytics_leaderboard'),
        ]);

        if (!ecoRes.error) this.renderEcoChart(ecoRes);
        if (!heatRes.error) this.renderHeatmap(heatRes);
        if (!retRes.error) this.renderRetention(retRes);
        if (!lbRes.error) this.renderLeaderboards(lbRes);
    },

    renderEcoChart(data) {
        if (this.charts['eco']) this.charts['eco'].destroy();
        const snaps = data.snapshots || [];
        const peak = data.peak || {};

        document.getElementById('a-peak-eco').innerText = this.fmtCoins(peak.peak_coins || 0) + ' ◎';

        const firstNonZero = snaps.find(s => s.total_coins > 0);
        const lastSnap = snaps[snaps.length - 1];
        if (firstNonZero && lastSnap && firstNonZero !== lastSnap) {
            const pct = (((lastSnap.total_coins - firstNonZero.total_coins) / firstNonZero.total_coins) * 100).toFixed(1);
            const el = document.getElementById('a-eco-growth');
            el.innerText = (parseFloat(pct) >= 0 ? '+' : '') + pct + '%';
            el.style.color = parseFloat(pct) >= 0 ? 'var(--emerald)' : 'var(--red)';
        }

        const anomalies = [];
        for (let i = 1; i < snaps.length; i++) {
            const prev = snaps[i - 1].total_coins;
            const curr = snaps[i].total_coins;
            if (prev > 0) {
                const change = ((curr - prev) / prev) * 100;
                if (Math.abs(change) >= 20) anomalies.push({ index: i, change, snap: snaps[i] });
            }
        }

        const badge = document.getElementById('eco-anomaly-badge');
        if (badge) badge.style.display = anomalies.length ? 'inline-block' : 'none';

        const ctx = document.getElementById('eco-chart')?.getContext('2d');
        if (!ctx) return;

        const grad = ctx.createLinearGradient(0, 0, 0, 320);
        grad.addColorStop(0, 'rgba(91, 106, 255, 0.25)');
        grad.addColorStop(1, 'rgba(91, 106, 255, 0)');

        this.charts['eco'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: snaps.map(s => {
                    const d = new Date(s.hour);
                    return this._analyticsDays <= 7
                        ? d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
                        : d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
                }),
                datasets: [
                    {
                        label: 'Total Coins',
                        data: snaps.map(s => s.total_coins),
                        borderColor: '#5b6aff',
                        backgroundColor: grad,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Online Players',
                        data: snaps.map(s => s.online_count ?? null),
                        borderColor: '#10b981',
                        backgroundColor: 'transparent',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        pointRadius: 0,
                        tension: 0.3,
                        yAxisID: 'y2',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#12131a',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: ctx => ctx.datasetIndex === 0 ? ` Coins: ${Number(ctx.raw).toLocaleString()} ◎` : ` Online: ${ctx.raw ?? '—'}`
                        }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6a6a82', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 } },
                    y: { position: 'left', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6a6a82', font: { family: 'JetBrains Mono', size: 10 }, callback: v => this.fmtCoins(v) + ' ◎' } },
                    y2: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#10b981', font: { family: 'JetBrains Mono', size: 10 } } }
                }
            }
        });
    },

    renderRetention(data) {
        if (this.charts['ret']) this.charts['ret'].destroy();
        const rows = data || [];
        const ctx = document.getElementById('retention-chart')?.getContext('2d');
        if (!ctx) return;

        this.charts['ret'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: rows.map(r => new Date(r.week_start).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })),
                datasets: [
                    { label: 'New', data: rows.map(r => r.new_players), backgroundColor: 'rgba(16, 185, 129, 0.8)', borderRadius: 2 },
                    { label: 'Returning', data: rows.map(r => r.returning_players), backgroundColor: 'rgba(91, 106, 255, 0.8)', borderRadius: 2 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { stacked: true, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6a6a82', font: { family: 'JetBrains Mono', size: 10 } } },
                    y: { stacked: true, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6a6a82', font: { family: 'JetBrains Mono', size: 10 } } }
                }
            }
        });
    },

    renderHeatmap(data) {
        const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const grid = {};
        let maxVal = 0;
        data.forEach(r => {
            grid[`${r.day_of_week}_${r.hour_of_day}`] = r.session_count;
            if (r.session_count > maxVal) maxVal = r.session_count;
        });

        let html = `<div style="display:flex;flex-direction:column;gap:3px;">`;
        DAYS.forEach((day, di) => {
            html += `<div style="display:flex;align-items:center;gap:3px;">
                <span class="mono text-muted" style="width:28px;font-size:10px;">${day}</span>`;
            for (let h = 0; h < 24; h++) {
                const val = grid[`${di}_${h}`] || 0;
                const alpha = maxVal > 0 ? (val / maxVal) : 0;
                const col = alpha > 0 ? `rgba(91, 106, 255, ${Math.max(0.15, alpha)})` : 'var(--bg-base)';
                html += `<div title="${day} ${h}:00 — ${val} sessions" style="width:14px;height:14px;background:${col};border-radius:2px;"></div>`;
            }
            html += `</div>`;
        });
        html += `</div>`;
        document.getElementById('heatmap-container').innerHTML = html;
    },

    renderLeaderboards(data) {
        const fmt = this.fmtDuration.bind(this);
        const fmtC = this.fmtCoins.bind(this);

        if (data.totals) {
            const avgEl = document.getElementById('a-avg-session');
            if (avgEl) avgEl.innerText = fmt(data.totals.avg_playtime_s);
            const sesEl = document.getElementById('a-sessions');
            if (sesEl) sesEl.innerText = Number(data.totals.total_sessions || 0).toLocaleString();
        }

        const makeTable = (rows, cols) => {
            if (!rows?.length) return `<p class="text-muted" style="padding:16px;">No entries.</p>`;
            return `<table class="data-table">
                <thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
                <tbody>${rows.map((r, i) => `<tr>
                    <td class="mono text-muted">#${i+1}</td>
                    ${cols.slice(1).map(c => `<td>${c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</td>`).join('')}
                </tr>`).join('')}</tbody>
            </table>`;
        };

        const nameLink = (name) => `<span class="btn-link" onclick="app.openProfileModal('${name}')">${name}</span>`;

        document.getElementById('lb-coins').innerHTML = makeTable(data.byCoins, [
            { label: '#' },
            { label: 'Player', key: 'name', fmt: v => nameLink(v) },
            { label: 'Balance', key: 'coins', fmt: v => `<span class="mono text-gold">${fmtC(v)} ◎</span>` }
        ]);
        document.getElementById('lb-playtime').innerHTML = makeTable(data.byPlaytime, [
            { label: '#' },
            { label: 'Player', key: 'name', fmt: v => nameLink(v) },
            { label: 'Playtime', key: 'total_playtime_s', fmt: v => `<span class="mono text-green">${fmt(v)}</span>` }
        ]);
        document.getElementById('lb-level').innerHTML = makeTable(data.byLevel, [
            { label: '#' },
            { label: 'Player', key: 'name', fmt: v => nameLink(v) },
            { label: 'Level', key: 'level', fmt: v => `<span class="role-pill" style="background:var(--purple-dim);color:var(--purple);">Lv.${v}</span>` }
        ]);
    },

    // ══════════════════════════════════════════════════════════
    // 11. STAFF MANAGEMENT
    // ══════════════════════════════════════════════════════════

    async loadStaff() {
        const res = await this.req('staff_list');
        const container = document.getElementById('staff-table-container');
        if (!container || res.error) return;

        container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${res.map(s => {
                    const isSelf = s.username === this.session.user.username;
                    return `<tr>
                        <td class="mono text-muted">#${s.id}</td>
                        <td style="font-weight:600;color:var(--text-primary);">${s.username} ${isSelf ? '<span class="role-pill" style="margin-left:4px;">YOU</span>' : ''}</td>
                        <td><span class="role-pill ${s.role}">${s.role.toUpperCase()}</span></td>
                        <td>
                            <div class="btn-row">
                                <select onchange="app.changeStaffRole(${s.id},'${s.username}',this.value)" ${isSelf ? 'disabled' : ''} style="width:auto;font-size:11px;padding:3px 6px;">
                                    <option value="mod" ${s.role==='mod'?'selected':''}>Mod</option>
                                    <option value="dev" ${s.role==='dev'?'selected':''}>Dev</option>
                                    <option value="admin" ${s.role==='admin'?'selected':''}>Admin</option>
                                </select>
                                <button class="btn-ghost sm" onclick="app.resetStaffToken(${s.id},'${s.username}')">Reset Token</button>
                                ${!isSelf ? `<button class="btn-danger-ghost sm" onclick="app.deleteStaff(${s.id},'${s.username}')">Delete</button>` : ''}
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    },

    async createStaff() {
        const username = document.getElementById('new-staff-user').value.trim();
        const password = document.getElementById('new-staff-pass').value;
        const role = document.getElementById('new-staff-role').value;
        const invite = document.getElementById('new-staff-invite').value.trim();

        if (!username || !password || !invite) return this.toast("All fields required", "error");

        const res = await this.req('staff_create', 'POST', { username, password, role, invite_code: invite });
        if (res.error) return this.toast(res.error, "error");

        this.toast(`Staff account created for ${username}`);
        document.getElementById('new-staff-user').value = '';
        document.getElementById('new-staff-pass').value = '';
        document.getElementById('new-staff-invite').value = '';
        this.loadStaff();
    },

    async changeStaffRole(id, username, role) {
        const ok = await this.confirm(`Set ${username}'s authorization level to ${role.toUpperCase()}?`);
        if (!ok) return;
        const res = await this.req('staff_update', 'POST', { id, role });
        if (res.error) return this.toast(res.error, "error");
        this.toast(`Role updated for ${username}`);
        this.loadStaff();
    },

    async resetStaffToken(id, username) {
        const ok = await this.confirm(`Reset session token for ${username}?`);
        if (!ok) return;
        const res = await this.req('staff_reset_token', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast(`Token reset for ${username}`);
    },

    async deleteStaff(id, username) {
        const ok = await this.confirm(`Permanently remove staff access for ${username}?`);
        if (!ok) return;
        const res = await this.req('staff_delete', 'POST', { id });
        if (res.error) return this.toast(res.error, "error");
        this.toast(`Staff member ${username} deleted`);
        this.loadStaff();
    },

    // ══════════════════════════════════════════════════════════
    // 12. SETTINGS & THEMING
    // ══════════════════════════════════════════════════════════

    _settings: {},

    loadSettings() {
        const saved = localStorage.getItem('brume_settings');
        this._settings = saved ? JSON.parse(saved) : { theme: 'dark', accent: 'indigo' };
        this.applySettings();
    },

    saveSettings() {
        localStorage.setItem('brume_settings', JSON.stringify(this._settings));
    },

    applySettings() {
        const s = this._settings;
        document.body.classList.remove('theme-dark', 'theme-midnight', 'theme-light');
        if (s.theme !== 'dark') document.body.classList.add(`theme-${s.theme}`);

        document.body.classList.remove('accent-indigo', 'accent-amber', 'accent-rose');
        document.body.classList.add(`accent-${s.accent}`);
    },

    renderSettingsUI() {
        const s = this._settings;
        document.querySelectorAll('.theme-btn[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === s.theme));
        document.querySelectorAll('.accent-swatch[data-accent]').forEach(b => b.classList.toggle('active', b.dataset.accent === s.accent));
    },

    setTheme(theme, btn) {
        this._settings.theme = theme;
        this.saveSettings();
        this.applySettings();
        document.querySelectorAll('.theme-btn[data-theme]').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
    },

    setAccent(accent, btn) {
        this._settings.accent = accent;
        this.saveSettings();
        this.applySettings();
        document.querySelectorAll('.accent-swatch').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
    },

    async changePassword() {
        const p1 = document.getElementById('change-pass').value;
        const p2 = document.getElementById('change-pass-confirm').value;
        if (!p1 || p1 !== p2) return this.toast("Passwords do not match", "error");
        const res = await this.req('change_password', 'POST', { password: p1 });
        if (res.error) return this.toast(res.error, "error");
        this.toast("Password updated");
        document.getElementById('change-pass').value = '';
        document.getElementById('change-pass-confirm').value = '';
    },

    async clearEconomySnapshots() {
        const ok = await this.confirm('Purge ALL economy snapshot records?');
        if (!ok) return;
        const res = await this.req('purge_snapshots', 'POST', {});
        if (res.error) return this.toast(res.error, "error");
        this.toast("Economy snapshots purged");
    },

    async clearSessionLogs() {
        const ok = await this.confirm('Purge ALL session logs?');
        if (!ok) return;
        const res = await this.req('purge_sessions', 'POST', {});
        if (res.error) return this.toast(res.error, "error");
        this.toast("Session logs purged");
    },

    // ══════════════════════════════════════════════════════════
    // 13. OMNIBAR SEARCH & PROFILE MODAL
    // ══════════════════════════════════════════════════════════

    _searchTimer: null,
    _modalChart: null,

    openSearch() {
        document.getElementById('search-overlay').style.display = 'flex';
        setTimeout(() => document.getElementById('search-input').focus(), 50);
    },

    closeSearch() {
        document.getElementById('search-overlay').style.display = 'none';
        document.getElementById('search-input').value = '';
    },

    doSearch(q) {
        clearTimeout(this._searchTimer);
        if (!q || q.length < 2) return;
        this._searchTimer = setTimeout(async () => {
            const res = await this.req('search', 'POST', { query: q });
            const container = document.getElementById('search-results');
            if (!res || (!res.players?.length && !res.punishments?.length && !res.logs?.length)) {
                container.innerHTML = `<div class="empty-hint" style="padding:24px;text-align:center;">No records match "${q}"</div>`;
                return;
            }
            let html = '';
            if (res.players?.length) {
                html += `<div style="padding:8px 16px;font-size:10px;color:var(--text-muted);font-weight:700;text-transform:uppercase;">Players</div>`;
                res.players.forEach(p => {
                    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border-dim);" onclick="app.closeSearch();app.openProfileModal('${p.name}')">
                        <span style="font-weight:600;">${p.name}</span>
                        <span class="mono text-muted" style="font-size:11px;">Lv.${p.level} · ${app.fmtCoins(p.coins)} ◎</span>
                    </div>`;
                });
            }
            container.innerHTML = html;
        }, 180);
    },

    async openProfileModal(name) {
        const modal = document.getElementById('profile-modal');
        modal.style.display = 'flex';
        document.getElementById('modal-name').innerText = name;
        document.getElementById('modal-avatar').innerText = name.charAt(0).toUpperCase();

        const [playerRes, historyRes, punishRes, sessionRes] = await Promise.all([
            this.req('lookup', 'POST', { query: name }),
            this.req(`analytics_player&uuid=lookup&name=${encodeURIComponent(name)}`),
            this.req('player_punishments', 'POST', { name }),
            this.req('player_sessions', 'POST', { name }),
        ]);

        if (playerRes && !playerRes.error) {
            document.getElementById('modal-uuid').innerText = playerRes.uuid;
            document.getElementById('modal-coins').innerText = this.fmtCoins(playerRes.coins) + ' ◎';
            document.getElementById('modal-level').innerText = playerRes.level || 1;
            document.getElementById('modal-playtime').innerText = this.fmtDuration(playerRes.total_playtime_s);
            document.getElementById('modal-sessions').innerText = playerRes.session_count || 0;
            this._modalPlayer = playerRes;
        }

        // Mini Chart
        if (this._modalChart) { this._modalChart.destroy(); this._modalChart = null; }
        if (historyRes?.length > 1) {
            const ctx = document.getElementById('modal-chart').getContext('2d');
            this._modalChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: historyRes.map(r => ''),
                    datasets: [{ data: historyRes.map(r => r.coins), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, fill: false }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
            });
        }

        const pList = document.getElementById('modal-punishments');
        pList.innerHTML = punishRes?.length
            ? punishRes.map(p => `<div style="padding:4px 0;font-size:11px;"><span class="badge-status banned">${p.type}</span> ${p.reason}</div>`).join('')
            : '<span class="text-green" style="font-size:11px;">Clean Record</span>';

        const sList = document.getElementById('modal-sessions-list');
        sList.innerHTML = sessionRes?.length
            ? sessionRes.slice(0, 6).map(s => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;"><span class="mono text-muted">${new Date(s.joined_at).toLocaleDateString('en-GB')}</span><span class="mono text-green">${this.fmtDuration(s.duration_s)}</span></div>`).join('')
            : '<span class="text-muted" style="font-size:11px;">No recorded sessions</span>';
    },

    closeProfileModal() {
        document.getElementById('profile-modal').style.display = 'none';
        if (this._modalChart) { this._modalChart.destroy(); this._modalChart = null; }
    },

    modalEditPlayer() {
        if (!this._modalPlayer) return;
        this.closeProfileModal();
        document.getElementById('p-search').value = this._modalPlayer.name;
        this.navigate('player');
        this.loadPlayerDetail();
    },

    modalBanPlayer() {
        if (!this._modalPlayer) return;
        this.closeProfileModal();
        this.quickBan(this._modalPlayer.name);
    },

    // ══════════════════════════════════════════════════════════
    // 14. CONFIRM DIALOG & MOBILE HANDLERS
    // ══════════════════════════════════════════════════════════

    _confirmResolve: null,
    confirm(msg) {
        return new Promise(resolve => {
            document.getElementById('confirm-body').innerText = msg;
            document.getElementById('confirm-modal').style.display = 'flex';
            this._confirmResolve = (val) => {
                document.getElementById('confirm-modal').style.display = 'none';
                resolve(val);
            };
        });
    },

    closeConfirm() {
        if (this._confirmResolve) this._confirmResolve(false);
    },

    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const isOpen = sidebar.classList.contains('open');
        sidebar.classList.toggle('open', !isOpen);
        overlay.classList.toggle('visible', !isOpen);
    },

    closeSidebar() {
        document.querySelector('.sidebar')?.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('visible');
    }
};

window.onload = () => app.init();
