const ops = {
    key: "",
    
    login() {
        this.key = document.getElementById('root-key').value;
        this.req('stats').then(res => {
            if (res.error) {
                document.getElementById('auth-msg').innerText = "ACCESS_DENIED";
            } else {
                document.getElementById('auth-layer').style.display = 'none';
                document.getElementById('dashboard-layer').style.display = 'flex';
                this.renderStats(res);
            }
        });
    },

    async req(mode, method = 'GET', body = null) {
        const opts = {
            method: method,
            headers: { 'Content-Type': 'application/json', 'x-brume-secret': this.key }
        };
        if (body) opts.body = JSON.stringify(body);
        return await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());
    },

    tab(id) {
        document.querySelectorAll('.panel').forEach(e => e.style.display = 'none');
        document.getElementById(`tab-${id}`).style.display = 'block';
        document.querySelectorAll('nav button').forEach(e => e.classList.remove('active'));
        event.target.classList.add('active');
    },

    renderStats(data) {
        document.getElementById('stat-users').innerText = data.user_count;
        document.getElementById('stat-eco').innerText = data.total_economy.toLocaleString();
        document.getElementById('stat-rich').innerText = data.top_player;
    },

    async lookup() {
        const q = document.getElementById('p-search').value;
        const res = await this.req('lookup', 'POST', { query: q });
        
        if (res.error) {
            alert("USER_NOT_FOUND");
        } else {
            document.getElementById('p-editor').style.display = 'block';
            document.getElementById('val-uuid').innerText = res.uuid;
            document.getElementById('val-name').innerText = res.name;
            document.getElementById('inp-coins').value = res.coins;
            document.getElementById('inp-level').value = res.level;
        }
    },

    async savePlayer() {
        const body = {
            uuid: document.getElementById('val-uuid').innerText,
            coins: document.getElementById('inp-coins').value,
            level: document.getElementById('inp-level').value
        };
        const res = await this.req('update', 'POST', body);
        if (res.success) alert("DATABASE_UPDATE :: SUCCESS");
    },

    generate() {
        const id = document.getElementById('gen-id').value.toUpperCase();
        const mat = document.getElementById('gen-mat').value;
        const name = document.getElementById('gen-name').value;
        const tier = document.getElementById('gen-tier').value;
        const dmg = document.getElementById('gen-dmg').value;
        const str = document.getElementById('gen-str').value;

        const code = `
    if {_id} is "${id}":
        if {_key} is "name": return "${name}"
        if {_key} is "material": return ${mat}
        if {_key} is "damage": return ${dmg}
        if {_key} is "strength": return ${str}
        if {_key} is "tier": return "${tier}"
        if {_key} is "type": return "WEAPON"
        if {_key} is "version": return 1
        # Generated via Brume OPS`;

        document.getElementById('gen-out').value = code;
    }
};
