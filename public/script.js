const ops = {
    key: "",
    activeInput: null,
    library: JSON.parse(localStorage.getItem('brume_lib')) || [],

    colors:[
        { name: "Common", hex: "#FFFFFF" }, { name: "Uncommon", hex: "#55FF55" },
        { name: "Rare", hex: "#55FFFF" }, { name: "Epic", hex: "#9D4EDD" },
        { name: "Legendary", hex: "#FFAA00" }, { name: "Mythic", hex: "#FF55FF" },
        { name: "Exclusive", hex: "#FFD700" }, { name: "Fennel", hex: "#51559B" }
    ],

    init() {
        this.renderColorGrid();
        this.renderLibrary();
        this.renderSnippets();
        // Dashboard is hidden, Auth is visible by default.
    },

    // --- AUTH ---
    async login() {
        this.key = document.getElementById('root-key').value;
        const btn = document.getElementById('login-btn');
        btn.innerText = "Authenticating...";
        
        try {
            // Bypass API for local UI testing if needed by uncommenting:
            // return this.unlockUI();
            
            const res = await this.req('stats');
            if (res.error) throw new Error("Invalid Key");
            
            this.unlockUI();
            document.getElementById('stat-users').innerText = res.user_count || 0;
            document.getElementById('stat-eco').innerText = (res.total_economy || 0).toLocaleString();
            
        } catch (e) {
            document.getElementById('auth-msg').innerText = "ACCESS DENIED";
            document.getElementById('auth-msg').style.color = "var(--danger)";
            btn.innerText = "Authenticate";
        }
    },

    unlockUI() {
        document.getElementById('auth-layer').style.display = 'none';
        document.getElementById('dashboard-layer').style.display = 'flex';
        this.navigate('generator');
        this.live();
        this.toast("Session Authenticated");
    },

    async req(mode, method = 'GET', body = null) {
        const opts = { method, headers: { 'Content-Type': 'application/json', 'x-brume-secret': this.key } };
        if (body) opts.body = JSON.stringify(body);
        return await fetch(`/api/ops?mode=${mode}`, opts).then(r => r.json());
    },

    currentSnipCat: 'ALL',
    
    snippetDB:[
        {
            title: "Metadata GUI Skeleton",
            cat: "GUI",
            desc: "The standard 1.21.1 zero-flicker chest GUI template.",
            code: `function openMyMenu(p: player):\n    set metadata tag "my_gui" of {_p} to chest inventory with 6 rows named "§8Menu Title"\n    set {_gui} to metadata tag "my_gui" of {_p}\n    \n    loop 54 times:\n        set slot (loop-value - 1) of {_gui} to black stained glass pane named " "\n        \n    open {_gui} to {_p}\n\non inventory click:\n    if event-inventory = (metadata tag "my_gui" of player):\n        cancel event\n        if index of event-slot is 13:\n            send "&aClicked!"`
        },
        {
            title: "Spawn 3D Interaction Entity",
            cat: "VISUALS",
            desc: "Spawns an invisible hitbox + visual block display (For altars, NPCS, etc).",
            code: `set {_loc} to player's location\n# 1. The Visual\nspawn block display at {_loc}:\n    set {_vis} to entity\n    set display block data of {_vis} to crying obsidian\n    set display scale of {_vis} to vector(1, 1, 1)\n\n# 2. The Hitbox\nspawn interaction at {_loc}:\n    set {_hitbox} to entity\n    set interaction width of {_hitbox} to 1.0\n    set interaction height of {_hitbox} to 1.0\n    set string tag "brume_type" of custom nbt compound of {_hitbox} to "MY_ENTITY"\n    set metadata value "visual" of {_hitbox} to {_vis}`
        },
        {
            title: "Extract NBT ID",
            cat: "NBT",
            desc: "Safely pull the custom ID from an item to check it against the registry.",
            code: `set {_i} to player's tool\nif {_i} is air:\n    stop\n\nset {_n} to custom nbt compound of {_i}\nset {_id} to string tag "id" of {_n}\n\nif {_id} is "GALE_HELMET":\n    send "It's the Gale Helmet!"`
        },
        {
            title: "Async SQL Execution",
            cat: "DB",
            desc: "Standard skript-reflect JDBC template for zero-lag database calls.",
            code: `run section async:\n    try:\n        set {_conn} to DriverManager.getConnection({-sql::url}, {-sql::user}, {-sql::pass})\n        set {_query} to "UPDATE players SET coins = ? WHERE uuid = ?"\n        set {_ps} to {_conn}.prepareStatement({_query})\n        \n        {_ps}.setInt(1, Integer.valueOf({_coins}))\n        {_ps}.setString(2, "%{_uuid}%")\n        \n        {_ps}.executeUpdate()\n        {_ps}.close()\n        {_conn}.close()\n    catch {_e}:\n        log "[SQL ERROR] %{_e}.getMessage()%" to console`
        },
        {
            title: "Client-Side Interpolation",
            cat: "VISUALS",
            desc: "Smoothly move/scale a display entity without server lag.",
            code: `# Set animation time (e.g., 20 ticks = 1 second)\nset interpolation duration of {_display} to 20 ticks\nset interpolation delay of {_display} to 0 ticks\n\n# Tell it what to do (Move, Scale, or Rotate)\nset display scale of {_display} to vector(2, 2, 2)\nrotate {_display} around y axis by 180`
        },
        {
            title: "Vector Dash (Math)",
            cat: "MATH",
            desc: "Pushes a player in the exact direction they are looking.",
            code: `set {_dir} to player's direction\nset {_vel} to {_dir}.clone().multiply(1.5)\nset velocity of player to {_vel}\nplay sound "entity.wind_charge.throw" to player\nmake 20 of cloud at player`
        },
        {
            title: "Action Bar Component",
            cat: "GUI",
            desc: "Send a MiniMessage string with a custom 1.21.1 sprite icon.",
            code: `set {_sprite} to "<sprite:item:diamond_sword>"\nset {_msg} to mini message from "<#ff5555>Combat Engaged %{_sprite}%"\nsend action bar {_msg} to player`
        }
    ],

    renderSnippets(query = "") {
        const container = document.getElementById('snippet-container');
        if (!container) return;

        let html = "";
        this.snippetDB.forEach(s => {
            // Filter Logic
            if (this.currentSnipCat !== 'ALL' && s.cat !== this.currentSnipCat) return;
            if (query && !s.title.toLowerCase().includes(query.toLowerCase()) && !s.desc.toLowerCase().includes(query.toLowerCase())) return;

            // HTML Encoding for the code block so <#HEX> tags don't break the HTML
            const safeCode = s.code.replace(/</g, "&lt;").replace(/>/g, "&gt;");

            html += `
            <div class="snip-card">
                <div class="snip-header">
                    <div class="snip-title">${s.title} <span class="snip-badge">${s.cat}</span></div>
                    <button class="snip-copy" onclick="ops.copySnip(this, \`${btoa(s.code)}\`)">COPY</button>
                </div>
                <div class="snip-body">
                    <pre class="snip-code">${safeCode}</pre>
                    <div class="snip-desc">${s.desc}</div>
                </div>
            </div>`;
        });
        container.innerHTML = html || "<p style='color:#666;'>No snippets found.</p>";
    },

    filterCat(cat) {
        this.currentSnipCat = cat;
        // Update Pill CSS
        document.querySelectorAll('#snip-cats .pill').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
        this.renderSnippets(document.getElementById('snip-search').value);
    },

    filterSnippets() {
        const q = document.getElementById('snip-search').value;
        this.renderSnippets(q);
    },

    copySnip(btn, b64Code) {
        // Decode the base64 code to prevent quotes from breaking the JS execution
        const rawCode = atob(b64Code);
        navigator.clipboard.writeText(rawCode);
        
        const originalText = btn.innerText;
        btn.innerText = "COPIED!";
        btn.style.background = "var(--success)";
        this.toast("Snippet copied to clipboard!");
        
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.background = "var(--accent)";
        }, 1500);
    },

    // --- NAVIGATION ---
    navigate(viewId) {
        document.querySelectorAll('.view-page').forEach(e => e.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
        event.target.classList.add('active');
    },

    // --- TOASTS ---
    toast(msg, type = "success") {
        const c = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerText = msg;
        c.appendChild(el);
        setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, 3000);
    },

    // --- ARCHITECT ENGINE ---
    live() {
        if(!document.getElementById('gen-id')) return;

        const d = {
            id: val('gen-id').toUpperCase(), mat: val('gen-mat'), name: val('gen-name'),
            tier: val('gen-tier'), type: val('gen-type'),
            dmg: val('gen-dmg'), str: val('gen-str'), crit: val('gen-crit'),
            hp: val('gen-hp'), def: val('gen-def'), spd: val('gen-spd'),
            mspd: val('gen-mspd'), mfort: val('gen-mfort'),
            ab_name: val('gen-ab-name'), ab_desc: val('gen-ab-desc'), flavor: val('gen-flavor'),
            p1: val('gen-p1') || "<#FFFFFF>", p2: val('gen-p2') || "<#AAAAAA>",
            enchants: document.getElementById('gen-enchants').checked
        };

        // Update Swatches
        setBg('swatch-name', d.p1); setBg('swatch-p1', d.p1); setBg('swatch-p2', d.p2); setBg('swatch-ab', "#FFAA00");

        // Generate Strict Skript Code
        let c = `    if {_id} is "${d.id}":\n`;
        if(d.name) c += `        if {_key} is "name": return "${this.injectColor(d.name, d.p1)}"\n`;
        if(d.mat) c += `        if {_key} is "material": return ${d.mat}\n`;
        c += `        if {_key} is "version": return 1\n`;

        const addS = (k, v) => { if(v) c += `        if {_key} is "${k}": return ${v}\n`; };
        addS("damage", d.dmg); addS("strength", d.str); addS("health", d.hp);
        addS("defense", d.def); addS("speed", d.spd); addS("mining_speed", d.mspd); addS("mining_fortune", d.mfort);

        if(d.tier) c += `        if {_key} is "tier": return "${d.tier}"\n`;
        if(d.type) c += `        if {_key} is "type": return "${d.type}"\n`;
        if(d.p1) c += `        if {_key} is "p_primary": return "${d.p1}"\n`;
        if(d.p2) c += `        if {_key} is "p_secondary": return "${d.p2}"\n`;

        if(d.ab_name) c += `        if {_key} is "ab_name": return "${d.ab_name}"\n`;
        if(d.ab_desc) c += `        if {_key} is "desc": return "${d.ab_desc}"\n`;
        if(d.flavor) c += `        if {_key} is "flavor": return "${d.flavor}"\n`;
        if(d.enchants) c += `        if {_key} is "enchants": return true\n`;

        document.getElementById('gen-out').value = c;
        this.renderPreview(d);
    },

    renderPreview(d) {
        const lore = document.getElementById('prev-lore');
        const name = document.getElementById('prev-name');
        const c1 = this.parseHex(d.p1); const c2 = this.parseHex(d.p2);
        
        name.innerHTML = `<span style="color:${c1}">${d.name || "Item Name"}</span>`;
        let h = "";
        
        const stat = (l, v, c, i) => v ? `<div><span style="color:#aaa">${l}:</span> <span style="color:${c}">+${v}</span> <span style="color:${c}">${i}</span></div>` : "";
        h += stat("Damage", d.dmg, "#ff5555", "🗡"); h += stat("Strength", d.str, "#ffaa00", "❁");
        h += stat("Health", d.hp, "#ff5555", "❤"); h += stat("Defense", d.def, "#55ff55", "🛡");
        h += stat("Speed", d.spd, c1, "⚡"); h += stat("Mining Spd", d.mspd, "#3ab0ff", "⛏");
        
        if(d.dmg || d.str || d.hp || d.def || d.spd || d.mspd) h += "<br>";

        if(d.ab_name) {
            h += `<div><span style="color:#ffaa00">Ability: <span style="color:${c1}; font-weight:bold;">${d.ab_name}</span></span> <span style="color:#aaa">RIGHT CLICK</span></div>`;
            d.ab_desc.split('|').forEach(l => h += `<div style="color:#aaa">${this.formatColors(l)}</div>`);
            h += `<br>`;
        }
        
        if(d.enchants) h += `<div><span style="color:#aaa">Enchantments:</span></div><div><span style="color:#555">[ </span><span style="color:#aaa">Empty Slot</span><span style="color:#555"> ]</span></div><br>`;
        if(d.flavor) h += `<div style="color:#555; font-style:italic;">${d.flavor}</div><br>`;
        
        h += `<div style="font-weight:bold;"><span style="color:${c1}">${d.tier}</span> <span style="color:${c2}">✦</span> <span style="color:${c1}">${d.type}</span></div>`;
        lore.innerHTML = h;
    },

    copyCode() {
        document.getElementById('gen-out').select();
        document.execCommand('copy');
        this.toast("Code Copied!");
    },
    resetGen() {
        document.querySelectorAll('.architect-form input, .architect-form textarea').forEach(el => {
            if(el.type !== 'checkbox') el.value = '';
        });
        document.getElementById('gen-p1').value = "<#FFFFFF>";
        document.getElementById('gen-p2').value = "<#777777>";
        this.live();
        this.toast("Form Cleared");
    },

    // --- LIBRARY SYSTEM ---
    saveToLibrary() {
        const id = val('gen-id').toUpperCase();
        if (!id) return this.toast("ID required to save!", "error");
        
        const data = {};
        document.querySelectorAll('.architect-form input, .architect-form select, .architect-form textarea').forEach(el => {
            if(el.type === 'checkbox') data[el.id] = el.checked;
            else data[el.id] = el.value;
        });

        const idx = this.library.findIndex(i => i['gen-id'] === id);
        if (idx > -1) this.library[idx] = data; else this.library.push(data);
        
        localStorage.setItem('brume_lib', JSON.stringify(this.library));
        this.renderLibrary();
        this.toast(`Saved ${id}`);
    },

    renderLibrary() {
        const div = document.getElementById('library-list');
        if(!div) return;
        div.innerHTML = this.library.map((item, i) => `
            <div class="lib-item" onclick="ops.loadFromLibrary(${i})">
                <div>
                    <strong style="color:${this.parseHex(item['gen-p1'])}">${item['gen-name'] || item['gen-id']}</strong><br>
                    <small style="color:var(--text-dim)">${item['gen-id']}</small>
                </div>
                <button class="lib-del" onclick="event.stopPropagation(); ops.delLibrary(${i})">×</button>
            </div>
        `).join('');
    },

    loadFromLibrary(idx) {
        const d = this.library[idx];
        Object.keys(d).forEach(k => {
            const el = document.getElementById(k);
            if(el) {
                if(el.type === 'checkbox') el.checked = d[k];
                else el.value = d[k];
            }
        });
        this.live();
        this.toast(`Loaded ${d['gen-id']}`);
    },

    delLibrary(idx) {
        this.library.splice(idx, 1);
        localStorage.setItem('brume_lib', JSON.stringify(this.library));
        this.renderLibrary();
        this.toast("Deleted from Library");
    },

    // --- COLOR MODAL ---
    renderColorGrid() {
        document.getElementById('rarity-colors').innerHTML = this.colors.map(c => 
            `<div class="color-btn" style="background:${c.hex}" onclick="ops.pickPreset('${c.hex}')" title="${c.name}"></div>`
        ).join('');
    },
    openColor(id) { this.activeInput = document.getElementById(id); document.getElementById('color-modal').style.display = 'flex'; },
    closeColor() { document.getElementById('color-modal').style.display = 'none'; },
    pickPreset(hex) { this.activeInput.value = `<${hex}>`; this.closeColor(); this.live(); },
    applyColor() { this.activeInput.value = document.getElementById('manual-hex').value; this.closeColor(); this.live(); },

    // --- DEV TOOLS (All restored) ---
    tools: {
        grad() {
            const txt = val('grad-text') || "Gradient";
            const c1 = ops.parseHex(val('grad-c1') || "<#55FFFF>");
            const c2 = ops.parseHex(val('grad-c2') || "<#51559B>");
            const prev = document.getElementById('grad-preview');
            prev.style.background = `linear-gradient(to right, ${c1}, ${c2})`;
            prev.style.webkitBackgroundClip = "text";
            prev.style.webkitTextFillColor = "transparent";
            prev.innerText = txt;
            document.getElementById('grad-out').value = `<gradient:${c1}:${c2}>${txt}</gradient>`;
        },
        xp() {
            const lvl = parseInt(val('math-lvl')) || 1;
            const def = parseInt(val('math-def')) || 0;
            const req = Math.round(40 * Math.pow(lvl + 1, 1.07));
            document.getElementById('out-req').innerText = req.toLocaleString() + " XP";
            let total = 0; for(let i=1; i<lvl; i++) total += Math.round(40 * Math.pow(i + 1, 1.07));
            document.getElementById('out-total').innerText = total.toLocaleString() + " XP";
            document.getElementById('out-def').innerText = ((1 - (100 / (100 + def))) * 100).toFixed(1) + "%";
        },
        mm() {
            let t = val('mm-in').replace(/&([0-9a-f])/g, "<$1>").replace(/&l/g, "<bold>").replace(/<#(.*?)>/g, "<#$1>");
            document.getElementById('mm-out').value = t;
            document.getElementById('mm-preview').innerHTML = ops.formatColors(val('mm-in'));
        },
        snip(type) {
            let c = "";
            if(type==='gui') c = `function openMenu(p: player):\n    set metadata tag "gui" of {_p} to chest inventory with 3 rows named "Menu"\n    open (metadata tag "gui" of {_p}) to {_p}`;
            if(type==='nbt') c = `set {_n} to custom nbt compound of player's tool\nset {_id} to string tag "id" of {_n}\nif {_id} is "ITEM":`;
            if(type==='loop') c = `loop all players:\n    if distance between loop-player and player < 5:\n        send "Close!" to loop-player`;
            if(type==='skull') c = `set {_h} to player head\nset string tag "SkullOwner;Name" of nbt compound of {_h} to "Notch"`;
            if(type==='packet') c = `import:\n    com.github.retrooper.packetevents.wrapper.play.server.WrapperPlayServerEntityAnimation`;
            if(type==='db') c = `run section async:\n    set {_conn} to DriverManager.getConnection({-sql::url}, {-sql::user}, {-sql::pass})\n    # ... logic\n    {_conn}.close()`;
            document.getElementById('snip-out').value = c;
            ops.toast("Snippet Generated");
        },
        simulateRNG() {
            const chance = parseInt(val('rng-chance'));
            const att = parseInt(val('rng-attempts'));
            const box = document.getElementById('rng-result');
            box.innerHTML = `> Simulating ${att.toLocaleString()} pulls at 1/${chance.toLocaleString()}<br>`;
            let drops = 0;
            for(let i=0; i<att; i++) { if(Math.random() < (1/chance)) drops++; }
            const prob = (1 - Math.pow((chance-1)/chance, att)) * 100;
            box.innerHTML += `> Result: <b style="color:var(--success)">${drops}</b> items dropped.<br>`;
            box.innerHTML += `> Probability of getting at least 1: <b>${prob.toFixed(2)}%</b>`;
            ops.toast("Simulation Complete");
        }
    },

    // --- HELPERS ---
    injectColor(t, h) { return t.includes("<#") ? t : h + t; },
    parseHex(v) { return v ? v.replace(/[<>]/g, '') : "#ffffff"; },
    formatColors(t) {
        if(!t) return "";
        const c = { 'c': '#FF5555', 'a': '#55FF55', 'b': '#55FFFF', 'e': '#FFFF55', 'f': '#FFFFFF', '7': '#AAAAAA', '8': '#555555' };
        t = t.replace(/<#(.*?)>/g, '</span><span style="color:#$1">');
        t = t.replace(/&([0-9a-f])/g, (m, x) => `</span><span style="color:${c[x]||'#fff'}">`);
        t = t.replace(/&l/g, '</span><span style="font-weight:bold; color:inherit">');
        return '<span>' + t + '</span>';
    }
};

function val(id) { const e = document.getElementById(id); return e ? e.value : ""; }
function setBg(id, v) { const e = document.getElementById(id); if(e) e.style.background = v ? v.replace(/[<>]/g, '') : "#fff"; }

window.onload = () => ops.init();
