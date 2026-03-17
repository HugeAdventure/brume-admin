const app = {
    session: null,

    init() {
        const savedSession = localStorage.getItem('brume_session');
        if (savedSession) {
            this.session = JSON.parse(savedSession);
            this.unlockUI();
        }
    },

    async login(e) {
        e.preventDefault();
        const user = document.getElementById('auth-user').value;
        const pass = document.getElementById('auth-pass').value;
        const btn = document.getElementById('login-btn');
        const err = document.getElementById('auth-error');

        btn.innerText = "AUTHENTICATING...";
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
            this.toast("Welcome back, " + this.session.user.username);

        } catch (error) {
            err.innerText = "// " + error.message;
            btn.innerText = "AUTHENTICATE";
        }
    },

    logout() {
        localStorage.removeItem('brume_session');
        location.reload();
    },

    async req(mode, method = 'GET', body = null) {
        if (!this.session) return { error: "No session" };

        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.session.token}`
            }
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());

        if (res.error === "Session expired or invalid") this.logout();
        return res;
    },

    async unlockUI() {
        document.getElementById('auth-layer').style.display = 'none';
        document.getElementById('dashboard-layer').style.display = 'flex';

        document.getElementById('profile-name').innerText = this.session.user.username;
        document.getElementById('profile-role').innerText = this.session.user.role.toUpperCase();
        document.getElementById('profile-avatar').innerText = this.session.user.username.charAt(0).toUpperCase();

        // Apply role badge class
        const badge = document.getElementById('profile-role');
        badge.className = 'badge ' + this.session.user.role;

        this.applyRolePermissions();

        if (['admin', 'mod'].includes(this.session.user.role)) {
            this.loadStats();
            this.loadLogs();
            this.loadOverviewLogs();
        }

        if (this.session.user.role === 'admin') {
            this.loadStaff();
        }
    },

    applyRolePermissions() {
        const role = this.session.user.role;
        const links = document.querySelectorAll('.nav-link[data-roles]');
        let firstAvailableView = null;

        links.forEach(link => {
            const allowedRoles = link.getAttribute('data-roles').split(',');
            if (!allowedRoles.includes(role)) {
                link.style.display = 'none';
            } else if (!firstAvailableView) {
                firstAvailableView = link.getAttribute('onclick').match(/'([^']+)'/)[1];
            }
        });

        if (firstAvailableView) this.navigate(firstAvailableView);
    },

    navigate(viewId) {
        document.querySelectorAll('.view-page').forEach(e => e.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');

        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
    },

    toast(msg, type = "success") {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 3000);
    },

    async loadStats() {
        const res = await this.req('stats');
        if (res.error) return this.toast("Stats: " + res.error, "error");

        document.getElementById('stat-users').innerText = res.user_count || 0;
        document.getElementById('stat-eco').innerText = Number(res.total_economy || 0).toLocaleString() + " ◎";
        document.getElementById('stat-rich').innerText = res.top_player || "None";
    },

    async loadOverviewLogs() {
        const res = await this.req('logs');
        const container = document.getElementById('overview-logs-container');
        if (res.error || !res.length) {
            container.innerHTML = `<p style="font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);padding:4px 0;">No recent activity.</p>`;
            return;
        }

        // Show 5 most recent entries as a compact list
        const recent = res.slice(0, 5);
        container.innerHTML = recent.map(l => {
            const date = new Date(l.timestamp).toLocaleString('en-GB', { hour12: false });
            return `<div style="display:flex;gap:16px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--border-dim);">
                <span style="font-family:'Space Mono',monospace;font-size:10px;color:var(--text-dim);white-space:nowrap;">${date}</span>
                <span style="font-family:'Space Mono',monospace;font-size:11px;color:var(--accent-bright);white-space:nowrap;">${l.username}</span>
                <span style="font-size:13px;color:var(--text-secondary);">${l.action}</span>
            </div>`;
        }).join('') + `<div style="padding-top:12px;"><button class="nav-link" style="padding:0;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:1px;color:var(--accent);" onclick="app.navigate('logs')">VIEW ALL LOGS →</button></div>`;
    },

    async savePlayer() {
        const body = {
            uuid: document.getElementById('val-uuid').innerText,
            name: document.getElementById('val-name').innerText,
            coins: document.getElementById('inp-coins').value,
            level: document.getElementById('inp-level').value
        };
        const res = await this.req('update', 'POST', body);

        if (res.error) this.toast(res.error, "error");
        else {
            this.toast("Player record updated.");
            this.loadLogs();
            this.loadStats();
        }
    },

    async loadStaff() {
        const res = await this.req('staff_list');
        if (res.error) return;

        let html = `<table class="data-table">
            <thead><tr><th>ID</th><th>Username</th><th>Access Level</th></tr></thead><tbody>`;

        res.forEach(s => {
            html += `<tr>
                <td class="mono" style="color:var(--text-dim);">#${s.id}</td>
                <td class="bold">${s.username}</td>
                <td><span class="badge ${s.role}">${s.role}</span></td>
            </tr>`;
        });

        html += `</tbody></table>`;
        document.getElementById('staff-table-container').innerHTML = html;
    },

    async loadLogs() {
        const res = await this.req('logs');
        const container = document.getElementById('logs-table-container');

        if (res.error) {
            container.innerHTML = `<p style="padding:24px;font-family:'Space Mono',monospace;font-size:12px;color:var(--red);">// Error: ${res.error}</p>`;
            return this.toast("Logs: " + res.error, "error");
        }

        let html = `<table class="data-table">
            <thead><tr><th>Timestamp</th><th>Staff Member</th><th>Action</th></tr></thead><tbody>`;

        if (res.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center;padding:32px;font-family:'Space Mono',monospace;font-size:12px;color:var(--text-dim);">// No entries found</td></tr>`;
        } else {
            res.forEach(l => {
                const date = new Date(l.timestamp).toLocaleString('en-GB', { hour12: false });
                html += `<tr>
                    <td class="mono" style="color:var(--text-dim);white-space:nowrap;">${date}</td>
                    <td class="bold mono" style="color:var(--accent-bright);">${l.username}</td>
                    <td style="color:var(--text-secondary);">${l.action}</td>
                </tr>`;
            });
        }

        html += `</tbody></table>`;
        container.innerHTML = html;
    },

    async lookupPlayer() {
        const q = document.getElementById('p-search').value;
        if (!q) return;

        const res = await this.req('lookup', 'POST', { query: q });
        if (res.error) return this.toast(res.error, "error");

        document.getElementById('p-editor').style.display = 'block';
        document.getElementById('val-name').innerText = res.name;
        document.getElementById('val-uuid').innerText = res.uuid;
        document.getElementById('inp-coins').value = res.coins;
        document.getElementById('inp-level').value = res.level;
    }
};

window.onload = () => app.init();
