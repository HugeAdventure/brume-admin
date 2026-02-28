const ops = {
    activeInput: null, // Tracks which input opened the color picker

    // --- BRUME STANDARDS ---
    colors: [
        { name: "Common", hex: "#FFFFFF" },
        { name: "Uncommon", hex: "#55FF55" },
        { name: "Rare", hex: "#55FFFF" },
        { name: "Epic", hex: "#9D4EDD" },
        { name: "Legendary", hex: "#FFAA00" },
        { name: "Mythic", hex: "#FF55FF" },
        { name: "Divine", hex: "#AA0000" },
        { name: "Fennel", hex: "#51559B" }
    ],

    init() {
        this.login(); // Or whatever init you have
        this.renderColorGrid();
        this.live(); // Initial render
    },

    renderColorGrid() {
        const grid = document.getElementById('rarity-colors');
        grid.innerHTML = this.colors.map(c => 
            `<div class="color-btn" style="background:${c.hex}" data-name="${c.name}" onclick="ops.pickPreset('${c.hex}')"></div>`
        ).join('');
    },


    updateToolHex(val) {
        const hex = "<#" + val.toUpperCase().substring(1) + ">";
        document.getElementById('tool-hex').value = hex;
        document.getElementById('tool-preview').style.background = val;
    },
    
    copyToolHex() {
        const val = document.getElementById('tool-hex').value;
        navigator.clipboard.writeText(val);
        alert("Copied: " + val);
    }

    openColor(inputId) {
        this.activeInput = document.getElementById(inputId);
        document.getElementById('color-modal').style.display = 'flex';
        // Pre-fill
        const current = this.activeInput.value;
        if(current.startsWith('<#')) {
            document.getElementById('manual-hex').value = current;
            document.getElementById('native-picker').value = current.replace('<', '').replace('>', '');
        }
    },

    closeColor() { document.getElementById('color-modal').style.display = 'none'; },

    pickPreset(hex) {
        this.setInputColor(`<${hex}>`);
        this.closeColor();
    },

    pickNative(hex) {
        document.getElementById('manual-hex').value = `<${hex.toUpperCase()}>`;
    },

    applyColor() {
        this.setInputColor(document.getElementById('manual-hex').value);
        this.closeColor();
    },

    setInputColor(val) {
        if (this.activeInput) {
            this.activeInput.value = val;
            this.live(); // Update preview instantly
        }
    },

    // --- THE "LIVE" GENERATOR ---
    live() {
        const d = {
            id: val('gen-id').toUpperCase(),
            mat: val('gen-mat'),
            name: val('gen-name'),
            tier: val('gen-tier'),
            type: val('gen-type'),
            dmg: val('gen-dmg'), str: val('gen-str'), crit: val('gen-crit'),
            hp: val('gen-hp'), def: val('gen-def'), spd: val('gen-spd'),
            mspd: val('gen-mspd'), mfort: val('gen-mfort'),
            ab_name: val('gen-ab-name'),
            ab_desc: val('gen-ab-desc'),
            flavor: val('gen-flavor'),
            p1: val('gen-p1'), p2: val('gen-p2'),
            enchants: document.getElementById('gen-enchants').checked
        };

        // Update Swatches
        this.updateSwatches(d);

        // 1. GENERATE SKRIPT CODE (FIXED FORMATTING)
        let c = `    if {_id} is "${d.id}":\n`;
        c += `        if {_key} is "name":\n            return "${this.injectColor(d.name, d.p1)}"\n`;
        c += `        if {_key} is "material":\n            return ${d.mat || "stone"}\n`;
        c += `        if {_key} is "version":\n            return 1\n`;

        // Helper for one-line returns
        const addStat = (key, val) => {
            if(val) c += `        if {_key} is "${key}":\n            return ${val}\n`;
        };

        addStat("damage", d.dmg);
        addStat("strength", d.str);
        addStat("health", d.hp);
        addStat("defense", d.def);
        addStat("speed", d.spd);
        addStat("mining_speed", d.mspd);
        addStat("mining_fortune", d.mfort);

        c += `        if {_key} is "tier":\n            return "${d.tier}"\n`;
        c += `        if {_key} is "type":\n            return "${d.type}"\n`;
        c += `        if {_key} is "p_primary":\n            return "${d.p1}"\n`;
        c += `        if {_key} is "p_secondary":\n            return "${d.p2}"\n`;

        if(d.ab_name) c += `        if {_key} is "ab_name":\n            return "${d.ab_name}"\n`;
        if(d.ab_desc) c += `        if {_key} is "desc":\n            return "${d.ab_desc}"\n`;
        if(d.flavor) c += `        if {_key} is "flavor":\n            return "${d.flavor}"\n`;
        if(d.enchants) c += `        if {_key} is "enchants":\n            return true\n`;

        document.getElementById('gen-out').value = c;

        // 2. UPDATE PREVIEW HTML
        this.renderPreview(d);
    },

    updateSwatches(d) {
        document.getElementById('swatch-name').style.background = this.parseHex(d.p1);
        document.getElementById('swatch-p1').style.background = this.parseHex(d.p1);
        document.getElementById('swatch-p2').style.background = this.parseHex(d.p2);
        // If ability name has a color, find it, else default gold
        document.getElementById('swatch-ab').style.background = "#FFAA00"; 
    },

    renderPreview(d) {
        const lore = document.getElementById('prev-lore');
        const name = document.getElementById('prev-name');
        
        // Name
        const col1 = this.parseHex(d.p1);
        const col2 = this.parseHex(d.p2);
        
        name.innerHTML = `<span style="color:${col1}">${d.name || "Unknown Item"}</span>`;
        
        let h = "";
        
        // Stats
        if(d.dmg) h += `<div><span style="color:#aaa">Damage:</span> <span style="color:#ff5555">+${d.dmg}</span></div>`;
        if(d.str) h += `<div><span style="color:#aaa">Strength:</span> <span style="color:#ff5555">+${d.str}</span> <span style="color:#ffaa00">❁</span></div>`;
        if(d.hp) h += `<div><span style="color:#aaa">Health:</span> <span style="color:#ff5555">+${d.hp}</span> <span style="color:#ff5555">❤</span></div>`;
        if(d.def) h += `<div><span style="color:#aaa">Defense:</span> <span style="color:#55ff55">+${d.def}</span> <span style="color:#55ff55">🛡</span></div>`;
        if(d.spd) h += `<div><span style="color:#aaa">Speed:</span> <span style="color:${col1}">+${d.spd}</span> <span style="color:#55ffff">⚡</span></div>`;
        
        h += `<br>`;
        
        // Ability
        if(d.ab_name) {
            h += `<div><span style="color:#ffaa00">Ability: <span style="color:${col1}; font-weight:bold;">${d.ab_name}</span></span> <span style="color:#aaa">RIGHT CLICK</span></div>`;
            d.ab_desc.split('|').forEach(l => h += `<div style="color:#aaa">${this.formatColors(l)}</div>`);
            h += `<br>`;
        }
        
        // Enchants
        if(d.enchants) {
            h += `<div><span style="color:#aaa">Enchantments:</span></div>`;
            h += `<div><span style="color:#555">[ </span><span style="color:#aaa">Empty Enchantment Slot</span><span style="color:#555"> ]</span></div>`;
            h += `<div><span style="color:#555">[ </span><span style="color:#aaa">Empty Enchantment Slot</span><span style="color:#555"> ]</span></div>`;
            h += `<br>`;
        }
        
        // Flavor
        if(d.flavor) {
            h += `<div style="color:#555; font-style:italic;">${d.flavor}</div>`;
            h += `<br>`;
        }
        
        // Footer
        h += `<div style="font-weight:bold;">
            <span style="color:${col1}">${d.tier}</span> <span style="color:${col2}">✦</span> <span style="color:${col1}">${d.type}</span>
        </div>`;
        
        lore.innerHTML = h;
    },
    
    // Helpers
    injectColor(text, hex) {
        if(!text) return "";
        if(text.includes("<#")) return text;
        return hex + text;
    },
    
    parseHex(val) {
        if(!val) return "#ffffff";
        return val.replace('<', '').replace('>', '');
    },

    formatColors(t) {
        if(!t) return "";
        
        const codes = {
            '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
            '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
            '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
            'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF'
        };

        t = t.replace(/<#(.*?)>/g, (match, hex) => {
            return `</span><span style="color:#${hex}">`;
        });

        t = t.replace(/&([0-9a-f])/g, (match, code) => {
            return `</span><span style="color:${codes[code]}">`;
        });

        t = t.replace(/&l/g, '</span><span style="font-weight:bold; color:inherit">');
        t = t.replace(/&o/g, '</span><span style="font-style:italic; color:inherit">');
        
        return '<span>' + t + '</span>';
    }
};

function val(id) { return document.getElementById(id).value; }
