// ui.ts - UI controls, mode management, and toolbar handlers
// Handles editor modes, grid/snap/ortho/crosshair toggles, theme switching, and UI state
// Update grid toggle button appearance
export function updateGridToggleButton(ctx) {
    if (!ctx.gridToggleBtnEl) {
        ctx.gridToggleBtnEl = document.getElementById('gridToggleBtn');
    }
    if (!ctx.gridToggleBtnEl)
        return;
    if (ctx.gridMode === 'off') {
        ctx.gridToggleBtnEl.classList.add('dim');
        ctx.gridToggleBtnEl.textContent = 'Grid';
    }
    else {
        ctx.gridToggleBtnEl.classList.remove('dim');
        if (ctx.gridMode === 'line') {
            ctx.gridToggleBtnEl.textContent = 'Grid: Lines';
        }
        else {
            ctx.gridToggleBtnEl.textContent = 'Grid: Dots';
        }
    }
}
// Toggle grid display mode (line -> dot -> off -> line)
export function toggleGrid(ctx) {
    // Cycle through: line -> dot -> off -> line
    if (ctx.gridMode === 'line') {
        ctx.gridMode = 'dot';
    }
    else if (ctx.gridMode === 'dot') {
        ctx.gridMode = 'off';
    }
    else {
        ctx.gridMode = 'line';
    }
    localStorage.setItem('grid.mode', ctx.gridMode);
    ctx.redrawGrid();
    updateGridToggleButton(ctx);
}
// Toggle junction dots visibility
export function toggleJunctionDots(ctx) {
    ctx.showJunctionDots = !ctx.showJunctionDots;
    localStorage.setItem('junctionDots.visible', ctx.showJunctionDots ? 'true' : 'false');
    updateJunctionDotsButton(ctx);
    ctx.redraw();
    ctx.renderDrawing(); // Update in-progress wire display
}
// Update junction dots button appearance
export function updateJunctionDotsButton(ctx) {
    const junctionDotsBtn = document.getElementById('junctionDotsBtn');
    if (!junctionDotsBtn)
        return;
    if (ctx.showJunctionDots) {
        junctionDotsBtn.classList.add('active');
    }
    else {
        junctionDotsBtn.classList.remove('active');
    }
}
// Toggle orthogonal mode
export function toggleOrtho(ctx, updateOrthoButtonVisual) {
    ctx.orthoMode = !ctx.orthoMode;
    ctx.saveOrthoMode();
    if (updateOrthoButtonVisual)
        updateOrthoButtonVisual();
}
// Update ortho button appearance
export function updateOrthoButton(ctx) {
    const orthoBtn = document.getElementById('orthoToggleBtn');
    if (!orthoBtn)
        return;
    // Show dimmed/inactive if endpoint circle is overriding ortho
    if (ctx.endpointOverrideActive) {
        orthoBtn.classList.remove('active');
        orthoBtn.style.opacity = '0.4';
    }
    // Show active if ortho mode is on OR if shift visual is active
    else if (ctx.orthoMode || ctx.shiftOrthoVisualActive) {
        orthoBtn.classList.add('active');
        orthoBtn.style.opacity = '';
    }
    else {
        orthoBtn.classList.remove('active');
        orthoBtn.style.opacity = '';
    }
}
// Cycle snap mode (50mil -> grid -> off -> 50mil)
export function cycleSnapMode(ctx) {
    // Cycle: 50mil → grid → off → 50mil
    if (ctx.snapMode === '50mil')
        ctx.snapMode = 'grid';
    else if (ctx.snapMode === 'grid')
        ctx.snapMode = 'off';
    else
        ctx.snapMode = '50mil';
    ctx.saveSnapMode();
    updateSnapButton(ctx);
    updateSnapStatus(ctx);
}
// Update snap button appearance
export function updateSnapButton(ctx) {
    const snapBtn = document.getElementById('snapToggleBtn');
    if (!snapBtn)
        return;
    // Update button text based on current mode
    if (ctx.snapMode === 'grid') {
        snapBtn.textContent = 'Grid';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: Grid (S)';
    }
    else if (ctx.snapMode === '50mil') {
        snapBtn.textContent = '50mil';
        snapBtn.classList.add('active');
        snapBtn.title = 'Snap mode: 50mil (S)';
    }
    else { // 'off'
        snapBtn.textContent = 'Off';
        snapBtn.classList.remove('active');
        snapBtn.title = 'Snap mode: Off (S)';
    }
}
// Update snap status display
export function updateSnapStatus(ctx) {
    const snapK = document.getElementById('snapKbd');
    if (!snapK)
        return;
    if (ctx.snapMode === 'off') {
        snapK.textContent = 'Snap: Off';
    }
    else if (ctx.snapMode === 'grid') {
        snapK.textContent = 'Snap: Grid';
    }
    else {
        snapK.textContent = 'Snap: 50mil';
    }
}
// Toggle crosshair mode (full <-> short)
export function toggleCrosshairMode(ctx) {
    ctx.crosshairMode = ctx.crosshairMode === 'full' ? 'short' : 'full';
    localStorage.setItem('crosshair.mode', ctx.crosshairMode);
    updateCrosshairButton(ctx);
    // Refresh crosshair display if in wire mode
    if (ctx.mode === 'wire' && ctx.drawing.cursor) {
        // renderCrosshair would need to be passed or called from app.ts
        ctx.renderDrawing();
    }
}
// Update crosshair button appearance
export function updateCrosshairButton(ctx) {
    const crosshairBtn = document.getElementById('crosshairToggleBtn');
    if (!crosshairBtn)
        return;
    if (ctx.crosshairMode === 'full') {
        crosshairBtn.classList.add('active');
    }
    else {
        crosshairBtn.classList.remove('active');
    }
}
// Toggle tracking mode
export function toggleTracking(ctx) {
    ctx.trackingMode = !ctx.trackingMode;
    localStorage.setItem('tracking.mode', ctx.trackingMode ? 'true' : 'false');
    updateTrackingButton(ctx);
    // Clear any active connection hint when disabling tracking
    if (!ctx.trackingMode) {
        ctx.connectionHint = null;
        ctx.renderConnectionHint();
    }
}
// Update tracking button appearance
export function updateTrackingButton(ctx) {
    const trackingBtn = document.getElementById('trackingToggleBtn');
    if (!trackingBtn)
        return;
    if (ctx.trackingMode) {
        trackingBtn.classList.add('active');
    }
    else {
        trackingBtn.classList.remove('active');
    }
}
// Toggle theme (light <-> dark)
export function toggleTheme(ctx) {
    const htmlEl = document.documentElement;
    const currentTheme = localStorage.getItem('theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(ctx, newTheme);
}
// Apply theme
export function applyTheme(ctx, theme) {
    const htmlEl = document.documentElement;
    const themeBtn = document.getElementById('themeToggleBtn');
    if (theme === 'light') {
        htmlEl.setAttribute('data-theme', 'light');
    }
    else {
        htmlEl.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
    // Update button icon
    if (themeBtn) {
        themeBtn.textContent = theme === 'light' ? '🌙' : '☀';
    }
    // Always redraw when theme changes - any black wires need to flip to white/black
    // Also update the in-progress drawing if active
    ctx.redraw();
    ctx.renderDrawing();
}
// Set editor mode
export function setMode(ctx, m, updateOrthoButtonVisual) {
    // Finalize any active wire drawing before mode change
    if (ctx.drawing.active && ctx.drawing.points.length > 0) {
        ctx.finishWire();
    }
    ctx.mode = m;
    ctx.overlayMode.textContent = m[0].toUpperCase() + m.slice(1);
    ctx.$qa('#modeGroup button').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === m);
    });
    // New: update custom junction dot buttons
    const pjBtn = document.getElementById('placeJunctionDotBtn');
    const djBtn = document.getElementById('deleteJunctionDotBtn');
    if (pjBtn)
        pjBtn.classList.toggle('active', m === 'place-junction');
    if (djBtn)
        djBtn.classList.toggle('active', m === 'delete-junction');
    // Ensure ortho button stays in sync when switching modes
    if (updateOrthoButtonVisual)
        updateOrthoButtonVisual();
    // reflect mode on body for cursor styles
    document.body.classList.remove('mode-select', 'mode-wire', 'mode-delete', 'mode-place', 'mode-pan', 'mode-move', 'mode-place-junction', 'mode-delete-junction');
    document.body.classList.add(`mode-${m}`);
    // If user switches to Delete with an active selection, apply delete immediately
    if (m === 'delete' && ctx.selection.kind) {
        if (ctx.selection.kind === 'component') {
            ctx.removeComponent(ctx.selection.id);
            return;
        }
        if (ctx.selection.kind === 'wire') {
            const w = ctx.wires.find((x) => x.id === ctx.selection.id);
            if (w) {
                ctx.removeJunctionsAtWireEndpoints(w);
                ctx.pushUndo();
                const wires = ctx.wires;
                const idx = wires.indexOf(w);
                if (idx >= 0)
                    wires.splice(idx, 1);
                ctx.selection = { kind: null, id: null, segIndex: null };
                ctx.normalizeAllWires();
                ctx.unifyInlineWires();
                ctx.redraw();
            }
            return;
        }
    }
    // Update diode subtype popup visibility with any mode change
    ctx.updateSubtypeVisibility();
    // SWP collapse is engaged as soon as Move mode is active with a selected component
    if (m === 'move') {
        ctx.ensureCollapseForSelection();
    }
    else {
        // Leaving Move mode finalizes any collapsed SWP back into segments
        ctx.ensureFinishSwpMove();
    }
    ctx.redraw(); // refresh wire/comp hit gating for the new mode
}
// Rotate selected component
export function rotateSelected(ctx) {
    if (ctx.selection.kind !== 'component')
        return;
    const components = ctx.components;
    const c = components.find((x) => x.id === ctx.selection.id);
    if (!c)
        return;
    ctx.pushUndo();
    c.rot = (c.rot + 90) % 360;
    // After rotation, if pins now cross a wire, split and remove bridge
    if (ctx.breakWiresForComponent(c)) {
        ctx.deleteBridgeBetweenPins(c);
    }
    ctx.redraw();
}
// Update capacitor button icon based on selected subtype and style
export function updateCapacitorButtonIcon(ctx) {
    const capacitorBtn = document.querySelector('#paletteRow1 button[data-tool="capacitor"]');
    if (!capacitorBtn)
        return;
    const svg = capacitorBtn.querySelector('svg');
    if (!svg)
        return;
    if (ctx.capacitorSubtype === 'polarized') {
        // Polarized capacitor icon - ANSI style (straight + curved)
        if (ctx.defaultResistorStyle === 'iec') {
            // IEC: two straight plates
            svg.innerHTML = `
        <path d="M2 12H26" />
        <path d="M26 4V20" />
        <path d="M38 4V20" />
        <path d="M38 12H62" />
      `.trim();
        }
        else {
            // ANSI: straight + curved
            svg.innerHTML = `
        <path d="M2 12H26" />
        <path d="M26 4V20" />
        <path d="M38 4 Q 32 12 38 20" />
        <path d="M38 12H62" />
      `.trim();
        }
    }
    else {
        // Standard capacitor icon (two straight plates)
        svg.innerHTML = `
      <path d="M2 12H26" />
      <path d="M26 4V20" />
      <path d="M38 4V20" />
      <path d="M38 12H62" />
    `.trim();
    }
}
// Update capacitor subtype buttons
export function updateCapacitorSubtypeButtons(ctx) {
    const standardBtn = document.getElementById('capacitorStandardBtn');
    const polarizedBtn = document.getElementById('capacitorPolarizedBtn');
    if (standardBtn) {
        standardBtn.classList.toggle('active', ctx.capacitorSubtype === 'standard');
    }
    if (polarizedBtn) {
        polarizedBtn.classList.toggle('active', ctx.capacitorSubtype === 'polarized');
    }
}
// Position subtype dropdown under active button
export function positionSubtypeDropdown(ctx) {
    if (!ctx.paletteRow2)
        return;
    const headerEl = document.querySelector('header');
    // Position under the active button (diode or capacitor)
    let activeBtn = null;
    if (ctx.placeType === 'diode') {
        activeBtn = document.querySelector('#paletteRow1 button[data-tool="diode"]');
    }
    else if (ctx.placeType === 'capacitor') {
        activeBtn = document.querySelector('#paletteRow1 button[data-tool="capacitor"]');
    }
    if (!headerEl || !activeBtn)
        return;
    const hb = headerEl.getBoundingClientRect();
    const bb = activeBtn.getBoundingClientRect();
    // Position just under the active button, with a small vertical gap
    ctx.paletteRow2.style.left = (bb.left - hb.left) + 'px';
    ctx.paletteRow2.style.top = (bb.bottom - hb.top + 6) + 'px';
}
// Install UI event handlers
export function installUIHandlers(ctx) {
    // Grid toggle
    const gridToggleBtnEl = document.getElementById('gridToggleBtn');
    if (gridToggleBtnEl) {
        gridToggleBtnEl.addEventListener('click', () => toggleGrid(ctx));
        updateGridToggleButton(ctx);
    }
    // Junction dots toggle
    const junctionDotsBtn = document.getElementById('junctionDotsBtn');
    if (junctionDotsBtn) {
        junctionDotsBtn.addEventListener('click', () => toggleJunctionDots(ctx));
        updateJunctionDotsButton(ctx);
    }
    // Ortho toggle
    const orthoBtn = document.getElementById('orthoToggleBtn');
    let updateOrthoButtonVisual = null;
    if (orthoBtn) {
        const updateFn = () => updateOrthoButton(ctx);
        updateOrthoButtonVisual = updateFn;
        orthoBtn.addEventListener('click', () => toggleOrtho(ctx, updateOrthoButtonVisual));
        updateOrthoButton(ctx);
    }
    // Snap toggle
    const snapBtn = document.getElementById('snapToggleBtn');
    if (snapBtn) {
        snapBtn.addEventListener('click', () => cycleSnapMode(ctx));
        updateSnapButton(ctx);
        updateSnapStatus(ctx);
    }
    // Crosshair toggle
    const crosshairBtn = document.getElementById('crosshairToggleBtn');
    if (crosshairBtn) {
        crosshairBtn.addEventListener('click', () => toggleCrosshairMode(ctx));
        updateCrosshairButton(ctx);
    }
    // Tracking toggle
    const trackingBtn = document.getElementById('trackingToggleBtn');
    if (trackingBtn) {
        trackingBtn.addEventListener('click', () => toggleTracking(ctx));
        updateTrackingButton(ctx);
    }
    // Theme toggle
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        // Load saved theme or default to dark
        const currentTheme = localStorage.getItem('theme') || 'dark';
        applyTheme(ctx, currentTheme);
        themeBtn.addEventListener('click', () => toggleTheme(ctx));
    }
    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        // Ignore when typing in inputs or with modifier keys
        if (e.altKey || e.ctrlKey || e.metaKey)
            return;
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable))
            return;
        if (e.key === 'g' || e.key === 'G') {
            e.preventDefault();
            toggleGrid(ctx);
        }
        else if (e.key === '.') {
            e.preventDefault();
            toggleJunctionDots(ctx);
        }
        else if (e.key === 'o' || e.key === 'O') {
            e.preventDefault();
            toggleOrtho(ctx, updateOrthoButtonVisual);
        }
        else if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            cycleSnapMode(ctx);
        }
        else if (e.key === 'x' || e.key === 'X' || e.key === '+' || e.key === '=') {
            e.preventDefault();
            toggleCrosshairMode(ctx);
        }
        else if (e.key === 't' || e.key === 'T') {
            e.preventDefault();
            toggleTracking(ctx);
        }
    });
    // Rotate button
    const rotateBtn = document.getElementById('rotateBtn');
    if (rotateBtn) {
        rotateBtn.addEventListener('click', () => rotateSelected(ctx));
    }
    return updateOrthoButtonVisual;
}
//# sourceMappingURL=ui.js.map