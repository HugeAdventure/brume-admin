const app = {
    session: null, // Holds { token, user: { username, role } }

    init() {
        // Check if already logged in
        const savedSession = localStorage.getItem('brume_session');
        if (savedSession) {
            this.session = JSON.parse(savedSession);
            this.unlockUI();
        }
    },

    // --- AUTHENTICATION ---
    async login(e) {
        e.preventDefault(); // Prevents the page from refreshing!
        const user = document.getElementById('auth-user').value;
        const pass = document.getElementById('auth-pass').value;
        const btn = document.getElementById('login-btn');
        const err = document.getElementById('auth-error');
        
        btn.innerText = "Authenticating...";
        err.innerText = "";

        try {
            const res = await fetch(`/api/ops?mode=login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            }).then(r => r.json());

            if (res.error) throw new Error(res.error);

            // Save Session
            this.session = { token: res.token, user: res.user };
            localStorage.setItem('brume_session', JSON.stringify(this.session));
            
            this.unlockUI();
            this.toast("Welcome back, " + this.session.user.username);

        } catch (error) {
            err.innerText = error.message;
            btn.innerText = "Sign In";
        }
    },

    logout() {
        localStorage.removeItem('brume_session');
        location.reload();
    },

    // --- CORE API REQUESTER ---
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
        
        // Handle expired token
        if (res.error === "Session expired or invalid") {
            this.logout();
        }
        return res;
    },

    // --- UI RENDERING ---
    async unlockUI() {
        document.getElementById('auth-layer').style.display = 'none';
        document.getElementById('dashboard-layer').style.display = 'flex';
        
        // Populate Profile Box
        document.getElementById('profile-name').innerText = this.session.user.username;
        document.getElementById('profile-role').innerText = this.session.user.role.toUpperCase();
        document.getElementById('profile-avatar').innerText = this.session.user.username.charAt(0).toUpperCase();

        this.applyRolePermissions();
        
        // Load initial data based on permission
        if (['admin', 'mod'].includes(this.session.user.role)) {
            this.loadStats();
            this.loadLogs(); // Load logs automatically
        }
        
        if (this.session.user.role === 'admin') {
            this.loadStaff(); // Load staff directory automatically
        }
    },

    applyRolePermissions() {
        const role = this.session.user.role;
        const links = document.querySelectorAll('.nav-link[data-roles]');
        let firstAvailableView = null;

        links.forEach(link => {
            const allowedRoles = link.getAttribute('data-roles').split(',');
            if (!allowedRoles.includes(role)) {
                link.style.display = 'none'; // Hide links user can't access
            } else if (!firstAvailableView) {
                // Find the first tab they DO have access to
                firstAvailableView = link.getAttribute('onclick').match(/'([^']+)'/)[1];
            }
        });

        if (firstAvailableView) this.navigate(firstAvailableView);
    },

    navigate(viewId) {
        document.querySelectorAll('.view-page').forEach(e => e.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        
        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
        if (event && event.target) {
            event.target.classList.add('active');
        }
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
        
        if (res.error) {
            console.error(res.error);
            return this.toast("Stats Error: " + res.error, "error");
        }

        document.getElementById('stat-users').innerText = res.user_count || 0;
        document.getElementById('stat-eco').innerText = Number(res.total_economy || 0).toLocaleString() + " Coins";
        document.getElementById('stat-rich').innerText = res.top_player || "None";
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
            this.toast("Player data updated successfully.");
            this.loadLogs();
            this.loadStats(); 
        }
    },

    async loadStaff() {
        const res = await this.req('staff_list');
        if (res.error) return;

        let html = `<table class="data-table">
            <thead><tr><th>ID</th><th>Username</th><th>Role</th></tr></thead><tbody>`;
        
        res.forEach(s => {
            html += `<tr>
                <td class="text-dim">#${s.id}</td>
                <td style="font-weight:600;">${s.username}</td>
                <td><span class="badge ${s.role}">${s.role}</span></td>
            </tr>`;
        });
        html += `</tbody></table>`;
        document.getElementById('staff-table-container').innerHTML = html;
    },

    async loadLogs() {
        const res = await this.req('logs');
        
        if (res.error) {
            document.getElementById('logs-table-container').innerHTML = `<p style="padding: 24px; color: var(--danger);">Error: ${res.error}</p>`;
            return this.toast("Logs DB Error: " + res.error, "error");
        }

        let html = `<table class="data-table">
            <thead><tr><th>Timestamp</th><th>Staff Member</th><th>Action Taken</th></tr></thead><tbody>`;
        
        if (res.length === 0) {
            html += `<tr><td colspan="3" style="text-align:center; padding: 24px; color: var(--text-dim);">No recent actions found.</td></tr>`;
        } else {
            res.forEach(l => {
                const date = new Date(l.timestamp).toLocaleString();
                html += `<tr>
                    <td class="text-dim">${date}</td>
                    <td style="font-weight:600;">${l.username}</td>
                    <td>${l.action}</td>
                </tr>`;
            });
        }
        
        html += `</tbody></table>`;
        document.getElementById('logs-table-container').innerHTML = html;
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
