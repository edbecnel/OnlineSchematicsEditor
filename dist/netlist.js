// netlist.ts - Net management and net class configuration
// Handles net list rendering, net class properties, wire color resolution
// ========================================================================================
// ===== NET CLASS UTILITIES =====
// ========================================================================================
/**
 * Get net class for a wire based on its netId or active net class.
 */
export function netClassForWire(w, NET_CLASSES, activeNetClass) {
    // Use wire's assigned netId if present
    if (w.netId) {
        return NET_CLASSES[w.netId] || NET_CLASSES.default;
    }
    // Fallback to default (activeNetClass is only used for UI display, not for determining wire properties)
    return NET_CLASSES.default;
}
/**
 * Create default NET_CLASSES object.
 */
export function createDefaultNetClasses(defaultWireColor, cssToRGBA01) {
    return {
        default: {
            id: 'default',
            name: 'Default',
            wire: { width: 0.25, type: 'solid', color: cssToRGBA01(defaultWireColor) },
            junction: { size: 0.762, color: cssToRGBA01('#FFFFFF') }
        }
    };
}
/**
 * Resolve wire color from color mode.
 */
export function resolveWireColor(mode) {
    const map = {
        custom: 'custom',
        white: '#ffffff',
        black: '#000000',
        red: 'red',
        green: 'lime',
        blue: 'blue',
        yellow: 'yellow',
        magenta: 'magenta',
        cyan: 'cyan'
    };
    return mode === 'auto' ? 'auto' : map[mode];
}
// ========================================================================================
// ===== NET LIST RENDERING =====
// ========================================================================================
/**
 * Render the net list UI panel.
 */
export function renderNetList(nets, wires, activeNetClass, NET_CLASSES, onSetActive, onEditNet, onDeleteNet) {
    const netListEl = document.getElementById('netList');
    if (!netListEl)
        return;
    // Collect all nets currently in use by wires
    const usedNets = new Set();
    wires.forEach(w => { if (w.netId)
        usedNets.add(w.netId); });
    // Merge with user-defined nets
    usedNets.forEach(n => nets.add(n));
    if (nets.size === 0) {
        netListEl.textContent = 'No nets defined';
        return;
    }
    const netArray = Array.from(nets).sort();
    netListEl.textContent = '';
    const ul = document.createElement('ul');
    ul.style.margin = '0.5rem 0';
    ul.style.padding = '0 0 0 1.2rem';
    ul.style.listStyle = 'none';
    netArray.forEach(netName => {
        const li = document.createElement('li');
        li.style.marginBottom = '0.3rem';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '0.5rem';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = netName;
        nameSpan.style.flex = '1';
        nameSpan.style.cursor = 'pointer';
        nameSpan.title = 'Click to set as active net class';
        // Show active indicator
        if (netName === activeNetClass) {
            nameSpan.style.fontWeight = 'bold';
            nameSpan.style.color = 'var(--accent)';
            const indicator = document.createElement('span');
            indicator.textContent = ' ●';
            indicator.style.fontSize = '0.7rem';
            nameSpan.appendChild(indicator);
        }
        // Click to set as active net class
        nameSpan.onclick = () => onSetActive(netName);
        // Edit button for all nets
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎';
        editBtn.style.padding = '0.1rem 0.4rem';
        editBtn.style.fontSize = '1rem';
        editBtn.style.lineHeight = '1';
        editBtn.style.cursor = 'pointer';
        editBtn.title = 'Edit net properties';
        editBtn.onclick = () => onEditNet(netName);
        li.appendChild(nameSpan);
        li.appendChild(editBtn);
        // Delete button (except for 'default')
        if (netName !== 'default') {
            const delBtn = document.createElement('button');
            delBtn.textContent = '×';
            delBtn.style.padding = '0.1rem 0.4rem';
            delBtn.style.fontSize = '1.2rem';
            delBtn.style.lineHeight = '1';
            delBtn.style.cursor = 'pointer';
            delBtn.title = 'Delete net';
            delBtn.onclick = () => onDeleteNet(netName);
            li.appendChild(delBtn);
        }
        ul.appendChild(li);
    });
    netListEl.appendChild(ul);
}
// ========================================================================================
// ===== NET MANAGEMENT =====
// ========================================================================================
/**
 * Add a new net with default properties.
 */
export function addNet(nets, NET_CLASSES, THEME, onSuccess) {
    const name = prompt('Enter net name:');
    if (!name)
        return false;
    const trimmed = name.trim();
    if (!trimmed)
        return false;
    if (nets.has(trimmed)) {
        alert(`Net "${trimmed}" already exists.`);
        return false;
    }
    // Create net class with default properties from THEME
    NET_CLASSES[trimmed] = {
        id: trimmed,
        name: trimmed,
        wire: { ...THEME.wire },
        junction: { ...THEME.junction }
    };
    nets.add(trimmed);
    onSuccess(trimmed);
    return true;
}
/**
 * Delete a net and reassign its wires to default.
 */
export function deleteNet(netName, nets, NET_CLASSES, wires) {
    if (netName === 'default')
        return false;
    if (!confirm(`Delete net "${netName}"? Wires using this net will be assigned to "default".`)) {
        return false;
    }
    nets.delete(netName);
    delete NET_CLASSES[netName];
    // Reassign any wires using this net to default
    wires.forEach(w => {
        if (w.netId === netName)
            w.netId = 'default';
    });
    return true;
}
/**
 * Show net properties dialog for editing wire width, style, and color.
 */
export function showNetPropertiesDialog(options) {
    const { netName, netClass, globalUnits, NM_PER_MM, formatDimForDisplay, parseDimInput, colorToHex, rgba01ToCss, onSave } = options;
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background-color: rgba(0,0,0,0.6); z-index: 999999;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
  `;
    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
    background: var(--panel); border: 1px solid #273042; border-radius: 12px;
    padding: 1.5rem; min-width: 400px; max-width: 500px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;
    // Title
    const title = document.createElement('h2');
    title.textContent = `Net Properties: ${netName}`;
    title.style.marginTop = '0';
    title.style.marginBottom = '1rem';
    dialog.appendChild(title);
    // Width control
    const widthRow = document.createElement('div');
    widthRow.style.marginBottom = '1rem';
    const widthLabel = document.createElement('label');
    widthLabel.textContent = `Wire Width (${globalUnits})`;
    widthLabel.style.display = 'block';
    widthLabel.style.marginBottom = '0.3rem';
    const widthInput = document.createElement('input');
    widthInput.type = 'text';
    const widthNm = Math.round((netClass.wire.width || 0) * NM_PER_MM);
    widthInput.value = formatDimForDisplay(widthNm, globalUnits);
    // Format width input on blur to show units
    widthInput.onblur = () => {
        const parsed = parseDimInput(widthInput.value || '0', globalUnits);
        if (parsed) {
            widthInput.value = formatDimForDisplay(parsed.nm, globalUnits);
        }
    };
    widthRow.appendChild(widthLabel);
    widthRow.appendChild(widthInput);
    dialog.appendChild(widthRow);
    // Line style control
    const styleRow = document.createElement('div');
    styleRow.style.marginBottom = '1rem';
    const styleLabel = document.createElement('label');
    styleLabel.textContent = 'Line Style';
    styleLabel.style.display = 'block';
    styleLabel.style.marginBottom = '0.3rem';
    const styleSelect = document.createElement('select');
    ['default', 'solid', 'dash', 'dot', 'dash_dot', 'dash_dot_dot'].forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v.replace(/_/g, '·');
        styleSelect.appendChild(o);
    });
    styleSelect.value = netClass.wire.type;
    styleRow.appendChild(styleLabel);
    styleRow.appendChild(styleSelect);
    dialog.appendChild(styleRow);
    // Color control
    const colorRow = document.createElement('div');
    colorRow.style.marginBottom = '1rem';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Wire Color';
    colorLabel.style.display = 'block';
    colorLabel.style.marginBottom = '0.3rem';
    const colorInputsRow = document.createElement('div');
    colorInputsRow.style.display = 'flex';
    colorInputsRow.style.gap = '0.5rem';
    colorInputsRow.style.alignItems = 'center';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.title = 'Pick color';
    const rgbCss = rgba01ToCss(netClass.wire.color);
    colorInput.value = colorToHex(rgbCss);
    const alphaInput = document.createElement('input');
    alphaInput.type = 'range';
    alphaInput.min = '0';
    alphaInput.max = '1';
    alphaInput.step = '0.05';
    alphaInput.style.flex = '1';
    alphaInput.value = String(netClass.wire.color.a);
    alphaInput.title = 'Opacity';
    const alphaLabel = document.createElement('span');
    alphaLabel.textContent = `${Math.round(netClass.wire.color.a * 100)}%`;
    alphaLabel.style.minWidth = '3ch';
    alphaLabel.style.fontSize = '0.9rem';
    alphaLabel.style.color = 'var(--muted)';
    alphaInput.oninput = () => {
        alphaLabel.textContent = `${Math.round(parseFloat(alphaInput.value) * 100)}%`;
    };
    // Color swatch toggle button
    const swatchToggle = document.createElement('button');
    swatchToggle.type = 'button';
    swatchToggle.title = 'Show color swatches';
    swatchToggle.style.cssText = `
    margin-left: 6px; width: 22px; height: 22px; border-radius: 4px;
    display: inline-flex; align-items: center; justify-content: center;
    padding: 0; font-size: 12px;
  `;
    swatchToggle.innerHTML = '<svg width="12" height="8" viewBox="0 0 12 8" xmlns="http://www.w3.org/2000/svg"><path d="M1 1l5 5 5-5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    colorInputsRow.appendChild(colorInput);
    colorInputsRow.appendChild(alphaInput);
    colorInputsRow.appendChild(alphaLabel);
    colorInputsRow.appendChild(swatchToggle);
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInputsRow);
    dialog.appendChild(colorRow);
    // Color swatch palette popover
    const swatches = [
        ['black', '#000000'],
        ['red', '#FF0000'], ['green', '#00FF00'], ['blue', '#0000FF'],
        ['cyan', '#00FFFF'], ['magenta', '#FF00FF'], ['yellow', '#FFFF00']
    ];
    const popover = document.createElement('div');
    popover.style.cssText = `
    position: absolute; display: none; z-index: 10001;
    background: var(--panel); padding: 8px; border-radius: 6px;
    border: 1px solid #273042; box-shadow: 0 6px 18px rgba(0,0,0,0.3);
  `;
    const pal = document.createElement('div');
    pal.style.display = 'grid';
    pal.style.gridTemplateColumns = `repeat(${swatches.length}, 18px)`;
    pal.style.gap = '8px';
    swatches.forEach(([name, col]) => {
        const b = document.createElement('button');
        b.title = name.toUpperCase();
        b.type = 'button';
        if (col === '#000000') {
            b.style.background = 'linear-gradient(to bottom right, #000000 0%, #000000 49%, #ffffff 51%, #ffffff 100%)';
            b.style.border = '1px solid #666666';
            b.title = 'BLACK/WHITE';
        }
        else {
            b.style.background = col;
            b.style.border = '1px solid rgba(0,0,0,0.12)';
        }
        b.style.cssText += 'width: 18px; height: 18px; border-radius: 4px; padding: 0; cursor: pointer;';
        b.onclick = (e) => {
            e.stopPropagation();
            colorInput.value = col;
            alphaInput.value = '1';
            alphaLabel.textContent = '100%';
            popover.style.display = 'none';
        };
        pal.appendChild(b);
    });
    popover.appendChild(pal);
    dialog.appendChild(popover);
    const showSwatchPopover = () => {
        const rect = swatchToggle.getBoundingClientRect();
        popover.style.left = `${rect.left}px`;
        popover.style.top = `${rect.bottom + 6}px`;
        popover.style.display = 'block';
    };
    const hideSwatchPopover = () => {
        popover.style.display = 'none';
    };
    swatchToggle.onclick = (e) => {
        e.stopPropagation();
        if (popover.style.display === 'block') {
            hideSwatchPopover();
        }
        else {
            showSwatchPopover();
        }
    };
    // Define cleanup first (needed for button handlers)
    let cleanupCalled = false;
    const cleanup = () => {
        if (cleanupCalled)
            return;
        cleanupCalled = true;
        document.removeEventListener('keydown', escHandler);
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };
    // Close on Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape' && document.body.contains(overlay)) {
            cleanup();
        }
    };
    // Buttons
    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = (e) => {
        e.stopPropagation();
        cleanup();
    };
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'ok';
    saveBtn.onclick = (e) => {
        e.stopPropagation();
        // Parse width
        const parsed = parseDimInput(widthInput.value || '0', globalUnits);
        const nm = parsed ? parsed.nm : 0;
        const valMm = nm / NM_PER_MM;
        // Parse color
        const hex = colorInput.value || '#ffffff';
        const m = hex.replace('#', '');
        const r = parseInt(m.slice(0, 2), 16);
        const g = parseInt(m.slice(2, 4), 16);
        const b = parseInt(m.slice(4, 6), 16);
        const a = Math.max(0, Math.min(1, parseFloat(alphaInput.value) || 1));
        onSave({
            width: valMm,
            type: styleSelect.value,
            color: { r: r / 255, g: g / 255, b: b / 255, a }
        });
        cleanup();
    };
    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(saveBtn);
    dialog.appendChild(buttonRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    // Mark the overlay so we can identify it's intentionally a modal dialog
    overlay.setAttribute('data-modal-dialog', 'true');
    // Only block events that hit the overlay itself (the dark background), not the dialog
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) {
            e.stopPropagation();
        }
    }, true);
    overlay.addEventListener('mouseup', (e) => {
        if (e.target === overlay) {
            e.stopPropagation();
        }
    }, true);
    document.addEventListener('keydown', escHandler);
}
//# sourceMappingURL=netlist.js.map