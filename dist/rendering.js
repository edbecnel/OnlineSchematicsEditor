// rendering.ts - SVG rendering and drawing
// Handles component symbols, wire visualization, junction dots, endpoint circles, selection outline
import { formatValue, getComponentBounds } from './components.js';
import { scaleForComponent } from './symbolScale.js';
import { mmToPx } from './conversions.js';
const SYMBOL_STROKE_DEFAULTS = {
    body: '#000000', // Black
    pin: '#FF0000', // Red
    powerSymbol: '#008000', // Green
    pinText: '#000000' // Black
};
const SYMBOL_FILL_DEFAULTS = {
    pinText: '#000000', // Black
    referenceText: '#0000FF', // Blue
    valueText: '#000000' // Black
};
const SYMBOL_THEME_STROKE_KEYS = {
    body: 'body',
    pin: 'pin',
    powerSymbol: 'powerSymbol',
    pinText: 'pinText'
};
const SYMBOL_THEME_FILL_KEYS = {
    pinText: 'pinText',
    referenceText: 'referenceText',
    valueText: 'valueText'
};
const FIFTY_MILS_PX = mmToPx(1.27);
const HUNDRED_MILS_PX = mmToPx(2.54);
const TEXT_FONT_SIZE = 12;
let currentSymbolTheme = null;
let currentThemeMode = 'dark';
export function setThemeMode(mode) {
    currentThemeMode = mode;
}
function parseRgbFromString(normalized) {
    const match = normalized.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/);
    if (!match)
        return null;
    return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10),
        a: match[4] !== undefined ? parseFloat(match[4]) : undefined
    };
}
function isPureBlackColor(normalized) {
    if (normalized === '#000000' || normalized === '#000' || normalized === 'black')
        return true;
    const rgb = parseRgbFromString(normalized);
    if (!rgb)
        return false;
    return rgb.r === 0 && rgb.g === 0 && rgb.b === 0;
}
function isPureWhiteColor(normalized) {
    if (normalized === '#ffffff' || normalized === '#fff' || normalized === 'white')
        return true;
    const rgb = parseRgbFromString(normalized);
    if (!rgb)
        return false;
    return rgb.r === 255 && rgb.g === 255 && rgb.b === 255;
}
function normalizeSymbolColorForTheme(color) {
    if (!color)
        return '';
    const trimmed = color.trim();
    if (!trimmed)
        return color;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('var(') || lower === 'none' || lower === 'currentcolor')
        return color;
    const normalized = lower.replace(/\s+/g, '');
    if (currentThemeMode === 'dark' && isPureBlackColor(normalized)) {
        return '#ffffff';
    }
    if (currentThemeMode === 'light' && isPureWhiteColor(normalized)) {
        return '#000000';
    }
    return color;
}
function cloneRgba(c) {
    return { r: c.r, g: c.g, b: c.b, a: c.a };
}
function cloneSymbolTheme(theme) {
    return {
        body: cloneRgba(theme.body),
        pin: cloneRgba(theme.pin),
        pinText: cloneRgba(theme.pinText),
        referenceText: cloneRgba(theme.referenceText),
        valueText: cloneRgba(theme.valueText),
        powerSymbol: cloneRgba(theme.powerSymbol)
    };
}
function applySymbolStroke(el, category = 'body') {
    el.setAttribute('data-symbol-stroke', category);
    const stroke = currentSymbolTheme
        ? rgba01ToCss(currentSymbolTheme[SYMBOL_THEME_STROKE_KEYS[category]])
        : SYMBOL_STROKE_DEFAULTS[category];
    const resolved = normalizeSymbolColorForTheme(stroke || SYMBOL_STROKE_DEFAULTS.body);
    el.setAttribute('stroke', resolved);
}
function applySymbolFill(el, category) {
    el.setAttribute('data-symbol-fill', category);
    const fill = currentSymbolTheme
        ? rgba01ToCss(currentSymbolTheme[SYMBOL_THEME_FILL_KEYS[category]])
        : SYMBOL_FILL_DEFAULTS[category];
    const resolved = normalizeSymbolColorForTheme(fill || SYMBOL_FILL_DEFAULTS[category]);
    el.setAttribute('fill', resolved);
}
export function setSymbolTheme(theme) {
    currentSymbolTheme = theme ? cloneSymbolTheme(theme) : null;
}
export function applySymbolStrokeColors(root = typeof document !== 'undefined' ? document : null) {
    if (!root || !currentSymbolTheme)
        return;
    const cssColors = {
        body: rgba01ToCss(currentSymbolTheme.body),
        pin: rgba01ToCss(currentSymbolTheme.pin),
        powerSymbol: rgba01ToCss(currentSymbolTheme.powerSymbol),
        pinText: rgba01ToCss(currentSymbolTheme.pinText)
    };
    const elements = root.querySelectorAll('[data-symbol-stroke]');
    elements.forEach((el) => {
        const attr = el.getAttribute('data-symbol-stroke');
        const category = attr === 'pin' || attr === 'powerSymbol' || attr === 'pinText' ? attr : 'body';
        const stroke = normalizeSymbolColorForTheme(cssColors[category]);
        el.setAttribute('stroke', stroke);
    });
}
export function applySymbolFillColors(root = typeof document !== 'undefined' ? document : null) {
    if (!root || !currentSymbolTheme)
        return;
    const fills = {
        pinText: rgba01ToCss(currentSymbolTheme.pinText),
        referenceText: rgba01ToCss(currentSymbolTheme.referenceText),
        valueText: rgba01ToCss(currentSymbolTheme.valueText)
    };
    const elements = root.querySelectorAll('[data-symbol-fill]');
    elements.forEach((el) => {
        const attr = el.getAttribute('data-symbol-fill');
        const category = attr === 'pinText' || attr === 'referenceText' || attr === 'valueText' ? attr : 'referenceText';
        const fill = normalizeSymbolColorForTheme(fills[category]);
        el.setAttribute('fill', fill);
    });
}
// ========================================================================================
// ===== SVG ELEMENT CREATION HELPERS =====
// ========================================================================================
const SVG_NS = 'http://www.w3.org/2000/svg';
function setAttr(el, name, value) {
    el.setAttribute(name, String(value));
}
function setAttrs(el, attrs) {
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
    }
}
export function rgba01ToCss(c) {
    const base = `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;
    return normalizeSymbolColorForTheme(base);
}
// ========================================================================================
// ===== COMPONENT SYMBOL RENDERING =====
// ========================================================================================
/**
 * Build SVG group for a component's symbol and label text.
 */
export function buildSymbolGroup(c, GRID, defaultResistorStyle) {
    const gg = document.createElementNS(SVG_NS, 'g');
    gg.setAttribute('transform', `rotate(${c.rot} ${c.x} ${c.y})`);
    const hasCustomGraphics = Array.isArray(c.graphics) && c.graphics.length > 0;
    const scale = scaleForComponent(hasCustomGraphics);
    const bodyGroup = document.createElementNS(SVG_NS, 'g');
    if (scale !== 1) {
        bodyGroup.setAttribute('transform', `translate(${c.x} ${c.y}) scale(${scale}) translate(${-c.x} ${-c.y})`);
    }
    gg.appendChild(bodyGroup);
    const add = (el) => { bodyGroup.appendChild(el); return el; };
    const line = (x1, y1, x2, y2, strokeCategory = 'body') => {
        const ln = document.createElementNS(SVG_NS, 'line');
        setAttrs(ln, { x1, y1, x2, y2, 'stroke-width': '2' });
        applySymbolStroke(ln, strokeCategory);
        return add(ln);
    };
    const path = (d, strokeCategory = 'body') => {
        const p = document.createElementNS(SVG_NS, 'path');
        setAttrs(p, { d, fill: 'none', 'stroke-width': '2' });
        applySymbolStroke(p, strokeCategory);
        return add(p);
    };
    const y = c.y, x = c.x;
    const ax = c.x - 50, bx = c.x + 50; // Pin positions at ±50 (2*GRID) prior to scaling
    const drawCustomGraphic = (gfx) => {
        const baseX = c.x;
        const baseY = c.y;
        switch (gfx.type) {
            case 'line': {
                const ln = document.createElementNS(SVG_NS, 'line');
                const strokeWidth = (gfx.strokeWidth ?? 2) * 2;
                setAttrs(ln, {
                    x1: baseX + gfx.x1,
                    y1: baseY + gfx.y1,
                    x2: baseX + gfx.x2,
                    y2: baseY + gfx.y2,
                    'stroke-width': String(strokeWidth)
                });
                if (gfx.stroke)
                    ln.setAttribute('stroke', normalizeSymbolColorForTheme(gfx.stroke));
                else
                    applySymbolStroke(ln, 'body');
                add(ln);
                break;
            }
            case 'polyline': {
                const poly = document.createElementNS(SVG_NS, 'polyline');
                const points = gfx.points.map(pt => `${baseX + pt.x},${baseY + pt.y}`).join(' ');
                const strokeWidth = (gfx.strokeWidth ?? 2) * 2;
                setAttrs(poly, {
                    points,
                    'stroke-width': String(strokeWidth)
                });
                if (gfx.stroke)
                    poly.setAttribute('stroke', normalizeSymbolColorForTheme(gfx.stroke));
                else
                    applySymbolStroke(poly, 'body');
                poly.setAttribute('fill', gfx.fill ? normalizeSymbolColorForTheme(gfx.fill) : 'none');
                add(poly);
                break;
            }
            case 'polygon': {
                const poly = document.createElementNS(SVG_NS, 'polygon');
                const points = gfx.points.map(pt => `${baseX + pt.x},${baseY + pt.y}`).join(' ');
                const strokeWidth = (gfx.strokeWidth ?? 2) * 2;
                setAttrs(poly, {
                    points,
                    'stroke-width': String(strokeWidth)
                });
                if (gfx.stroke)
                    poly.setAttribute('stroke', normalizeSymbolColorForTheme(gfx.stroke));
                else
                    applySymbolStroke(poly, 'body');
                poly.setAttribute('fill', gfx.fill ? normalizeSymbolColorForTheme(gfx.fill) : 'none');
                add(poly);
                break;
            }
            case 'rectangle': {
                const rect = document.createElementNS(SVG_NS, 'rect');
                const strokeWidth = (gfx.strokeWidth ?? 2) * 2;
                setAttrs(rect, {
                    x: baseX + gfx.x,
                    y: baseY + gfx.y,
                    width: gfx.width,
                    height: gfx.height,
                    'stroke-width': String(strokeWidth)
                });
                if (gfx.stroke)
                    rect.setAttribute('stroke', normalizeSymbolColorForTheme(gfx.stroke));
                else
                    applySymbolStroke(rect, 'body');
                rect.setAttribute('fill', gfx.fill ? normalizeSymbolColorForTheme(gfx.fill) : 'none');
                add(rect);
                break;
            }
            case 'circle': {
                const circle = document.createElementNS(SVG_NS, 'circle');
                const strokeWidth = (gfx.strokeWidth ?? 2) * 2;
                setAttrs(circle, {
                    cx: baseX + gfx.cx,
                    cy: baseY + gfx.cy,
                    r: gfx.r,
                    'stroke-width': String(strokeWidth)
                });
                if (gfx.stroke)
                    circle.setAttribute('stroke', normalizeSymbolColorForTheme(gfx.stroke));
                else
                    applySymbolStroke(circle, 'body');
                circle.setAttribute('fill', gfx.fill ? normalizeSymbolColorForTheme(gfx.fill) : 'none');
                add(circle);
                break;
            }
            case 'path': {
                const pathEl = document.createElementNS(SVG_NS, 'path');
                const strokeWidth = (gfx.strokeWidth ?? 2) * 2;
                setAttrs(pathEl, {
                    d: gfx.d,
                    'stroke-width': String(strokeWidth)
                });
                if (gfx.stroke)
                    pathEl.setAttribute('stroke', normalizeSymbolColorForTheme(gfx.stroke));
                else
                    applySymbolStroke(pathEl, 'body');
                pathEl.setAttribute('fill', gfx.fill ? normalizeSymbolColorForTheme(gfx.fill) : 'none');
                add(pathEl);
                break;
            }
            case 'text': {
                const txt = document.createElementNS(SVG_NS, 'text');
                const fontSize = gfx.fontSize ?? 12;
                const textX = baseX + gfx.x;
                const textY = baseY + gfx.y;
                setAttrs(txt, {
                    x: textX,
                    y: textY,
                    'font-size': String(fontSize),
                    'text-anchor': gfx.anchor ?? 'start',
                    transform: `rotate(${-c.rot} ${textX} ${textY})`,
                    'pointer-events': 'none'
                });
                applySymbolFill(txt, 'referenceText');
                txt.textContent = gfx.text;
                add(txt);
                break;
            }
            case 'arc':
            default:
                // Unsupported primitives are ignored for now
                break;
        }
    };
    const drawCustomPins = () => {
        if (!c.pins || c.pins.length === 0)
            return;
        for (const pin of c.pins) {
            const originX = c.x + pin.x;
            const originY = c.y + pin.y;
            const length = pin.length ?? GRID * 2;
            const rad = (pin.rotation * Math.PI) / 180;
            const dx = Math.cos(rad);
            const dy = -Math.sin(rad);
            const endX = originX + dx * length;
            const endY = originY + dy * length;
            const pinLine = document.createElementNS(SVG_NS, 'line');
            setAttrs(pinLine, {
                x1: originX,
                y1: originY,
                x2: endX,
                y2: endY,
                'stroke-width': '2',
                'stroke-linecap': 'round'
            });
            applySymbolStroke(pinLine, 'pin');
            add(pinLine);
            if (pin.visible === false)
                continue;
            const showNumber = pin.showNumber !== false;
            const showName = !!pin.name && pin.showName !== false;
            if (!showNumber && !showName)
                continue;
            const normalX = -dy;
            const normalY = dx;
            if (showNumber) {
                const numberOffset = 6;
                const numberX = originX + normalX * numberOffset;
                const numberY = originY + normalY * numberOffset;
                const numberText = document.createElementNS(SVG_NS, 'text');
                setAttrs(numberText, {
                    x: numberX,
                    y: numberY,
                    'font-size': '10',
                    'text-anchor': 'middle',
                    'dominant-baseline': 'middle',
                    transform: `rotate(${-c.rot} ${numberX} ${numberY})`,
                    'pointer-events': 'none'
                });
                applySymbolFill(numberText, 'pinText');
                numberText.textContent = pin.id ?? '';
                add(numberText);
            }
            if (showName) {
                const nameOffset = 12;
                const nameX = endX + normalX * nameOffset;
                const nameY = endY + normalY * nameOffset;
                const nameText = document.createElementNS(SVG_NS, 'text');
                setAttrs(nameText, {
                    x: nameX,
                    y: nameY,
                    'font-size': '10',
                    'text-anchor': 'start',
                    'dominant-baseline': 'middle',
                    transform: `rotate(${-c.rot} ${nameX} ${nameY})`,
                    'pointer-events': 'none'
                });
                applySymbolFill(nameText, 'pinText');
                nameText.textContent = pin.name;
                add(nameText);
            }
        }
    };
    if (hasCustomGraphics) {
        c.graphics.forEach(drawCustomGraphic);
    }
    else {
        switch (c.type) {
            case 'resistor':
                drawResistor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add);
                break;
            case 'capacitor':
                drawCapacitor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add);
                break;
            case 'inductor':
                drawInductor(x, y, ax, bx, line, path);
                break;
            case 'diode':
                drawDiodeInto(bodyGroup, c, c.props?.subtype || 'generic');
                break;
            case 'battery':
                drawBattery(c, x, y, GRID, line, add);
                break;
            case 'ac':
                drawACSource(x, y, ax, bx, line, add, path);
                break;
            case 'npn':
            case 'pnp':
                drawTransistor(c, x, y, line, add);
                break;
            case 'ground':
                drawGround(x, y, line);
                break;
        }
    }
    if (c.pins && c.pins.length > 0) {
        drawCustomPins();
    }
    // Label and value text placement (always upright)
    const bounds = getComponentBounds(c);
    const rot = ((c.rot % 360) + 360) % 360;
    const isHorizontal = rot === 0 || rot === 180;
    const isVertical = rot === 90 || rot === 270;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const topY = Math.min(bounds.minY, bounds.maxY);
    const rightX = Math.max(bounds.minX, bounds.maxX);
    const toLocalCoords = (worldX, worldY) => {
        if (rot === 0) {
            return { x: worldX, y: worldY };
        }
        const radians = (-rot * Math.PI) / 180;
        const cosR = Math.cos(radians);
        const sinR = Math.sin(radians);
        const dx = worldX - c.x;
        const dy = worldY - c.y;
        return {
            x: c.x + dx * cosR - dy * sinR,
            y: c.y + dx * sinR + dy * cosR
        };
    };
    let labelLocalX;
    let labelLocalY;
    let valueLocalX;
    let valueLocalY;
    let labelAnchor;
    let valueAnchor;
    if (isVertical) {
        const textWorldX = rightX + FIFTY_MILS_PX;
        const spacing = TEXT_FONT_SIZE + FIFTY_MILS_PX;
        const offset = spacing / 2;
        const shiftDown = FIFTY_MILS_PX;
        const valueWorldY = centerY + offset + shiftDown;
        const labelWorldY = centerY - offset + shiftDown;
        const labelLocal = toLocalCoords(textWorldX, labelWorldY);
        const valueLocal = toLocalCoords(textWorldX, valueWorldY);
        labelLocalX = labelLocal.x;
        labelLocalY = labelLocal.y;
        valueLocalX = valueLocal.x;
        valueLocalY = valueLocal.y;
        labelAnchor = 'start';
        valueAnchor = 'start';
    }
    else {
        const valueWorldY = topY - HUNDRED_MILS_PX;
        const labelWorldY = valueWorldY - (TEXT_FONT_SIZE + FIFTY_MILS_PX);
        const labelWorldX = centerX;
        const valueWorldX = centerX;
        const labelLocal = toLocalCoords(labelWorldX, labelWorldY);
        const valueLocal = toLocalCoords(valueWorldX, valueWorldY);
        labelLocalX = labelLocal.x;
        labelLocalY = labelLocal.y;
        valueLocalX = valueLocal.x;
        valueLocalY = valueLocal.y;
        labelAnchor = 'middle';
        valueAnchor = 'middle';
    }
    if (c.labelOffsetX !== undefined)
        labelLocalX += c.labelOffsetX;
    if (c.labelOffsetY !== undefined)
        labelLocalY += c.labelOffsetY;
    if (c.valueOffsetX !== undefined)
        valueLocalX += c.valueOffsetX;
    if (c.valueOffsetY !== undefined)
        valueLocalY += c.valueOffsetY;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('data-label-for', c.id);
    setAttrs(label, {
        x: labelLocalX,
        y: labelLocalY,
        'text-anchor': labelAnchor,
        'dominant-baseline': 'alphabetic',
        'font-size': String(TEXT_FONT_SIZE),
        transform: `rotate(${-rot} ${labelLocalX} ${labelLocalY})`,
        'pointer-events': 'all',
        'cursor': 'move',
        'user-select': 'none'
    });
    applySymbolFill(label, 'referenceText');
    label.textContent = c.label;
    gg.appendChild(label);
    const valText = formatValue(c);
    if (valText) {
        const value = document.createElementNS(SVG_NS, 'text');
        value.setAttribute('data-value-for', c.id);
        setAttrs(value, {
            x: valueLocalX,
            y: valueLocalY,
            'text-anchor': valueAnchor,
            'dominant-baseline': 'alphabetic',
            'font-size': String(TEXT_FONT_SIZE),
            transform: `rotate(${-rot} ${valueLocalX} ${valueLocalY})`,
            'pointer-events': 'all',
            'cursor': 'move',
            'user-select': 'none'
        });
        applySymbolFill(value, 'valueText');
        value.textContent = valText;
        gg.appendChild(value);
    }
    if (c.type === 'battery' || c.type === 'ac') {
        const extraY = valueLocalY + TEXT_FONT_SIZE + FIFTY_MILS_PX;
        const vtxt = document.createElementNS(SVG_NS, 'text');
        setAttrs(vtxt, {
            x: valueLocalX,
            y: extraY,
            'text-anchor': valueAnchor,
            'font-size': String(TEXT_FONT_SIZE),
            transform: `rotate(${-rot} ${valueLocalX} ${extraY})`
        });
        applySymbolFill(vtxt, 'valueText');
        const v = (c.props?.voltage ?? '') !== '' ? `${c.props.voltage} V` : '';
        vtxt.textContent = v;
        gg.appendChild(vtxt);
    }
    return gg;
}
function drawResistor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add) {
    const style = c.props?.resistorStyle || defaultResistorStyle;
    if (style === 'iec') {
        // IEC rectangular resistor
        const rectWidth = 60;
        const rectLeft = x - rectWidth / 2;
        const rectRight = x + rectWidth / 2;
        line(ax, y, rectLeft, y, 'pin');
        line(rectRight, y, bx, y, 'pin');
        const rect = document.createElementNS(SVG_NS, 'rect');
        setAttrs(rect, {
            x: rectLeft, y: y - 12, width: rectWidth, height: 24, rx: 1,
            'stroke-width': '2', fill: 'none'
        });
        applySymbolStroke(rect);
        add(rect);
    }
    else {
        // US/ANSI zigzag resistor
        line(ax, y, x - 39, y, 'pin');
        path(`M ${x - 39} ${y} L ${x - 33} ${y - 12} L ${x - 21} ${y + 12} L ${x - 9} ${y - 12} L ${x + 3} ${y + 12} L ${x + 15} ${y - 12} L ${x + 27} ${y + 12} L ${x + 33} ${y}`, 'body');
        line(x + 33, y, bx, y, 'pin');
    }
}
function drawCapacitor(gg, c, x, y, ax, bx, defaultResistorStyle, line, path, add) {
    const subtype = c.props?.capacitorSubtype || 'standard';
    if (subtype === 'polarized') {
        const style = c.props?.capacitorStyle || defaultResistorStyle;
        const x1 = x - 6, x2 = x + 6;
        if (style === 'iec') {
            // IEC polarized: straight plates with +/- marks, leads to 50 mil grid
            line(ax, y, x1, y, 'pin');
            line(x1, y - 16, x1, y + 16, 'body');
            line(x2, y - 16, x2, y + 16, 'body');
            line(x2, y, bx, y, 'pin');
            line(x - 18, y - 24, x - 18, y - 12, 'pinText');
            line(x - 24, y - 18, x - 12, y - 18, 'pinText');
            line(x + 12, y - 18, x + 24, y - 18, 'pinText');
        }
        else {
            // ANSI polarized: straight + curved plates, leads to 50 mil grid
            line(ax, y, x1, y, 'pin');
            line(x1, y - 16, x1, y + 16, 'body');
            const curveLeft = x2 - 6;
            path(`M ${x2} ${y - 16} Q ${curveLeft} ${y} ${x2} ${y + 16}`, 'body');
            line(x2, y, bx, y, 'pin');
            line(x - 20, y - 24, x - 20, y - 12, 'pinText');
            line(x - 26, y - 18, x - 14, y - 18, 'pinText');
        }
    }
    else {
        // Standard non-polarized capacitor, leads to 50 mil grid
        const x1 = x - 6, x2 = x + 6;
        line(ax, y, x1, y, 'pin');
        line(x1, y - 16, x1, y + 16, 'body');
        line(x2, y - 16, x2, y + 16, 'body');
        line(x2, y, bx, y, 'pin');
    }
}
function drawInductor(x, y, ax, bx, line, path) {
    // Inductor with 4 semicircular coils as in assets/Inductor.svg
    // Total width: ax to bx = 100px
    // 4 coils of radius 8 = 64px for coils
    // Remaining space: 100 - 64 = 36px for leads, so 18px each side
    const r = 8;
    const coilWidth = 64; // 4 coils * 2 * radius
    const leadLength = (bx - ax - coilWidth) / 2;
    const coilStart = ax + leadLength;
    const coilEnd = coilStart + coilWidth;
    // Left lead
    line(ax, y, coilStart, y, 'pin');
    // 4 semicircles going up (a command with positive y creates upward arc)
    const d = `M ${coilStart} ${y}
    a ${r} ${r} 0 0 1 ${r * 2} 0
    a ${r} ${r} 0 0 1 ${r * 2} 0
    a ${r} ${r} 0 0 1 ${r * 2} 0
    a ${r} ${r} 0 0 1 ${r * 2} 0`;
    path(d, 'body');
    // Right lead
    line(coilEnd, y, bx, y, 'pin');
}
function drawDiodeInto(group, c, subtype) {
    const sw = 2;
    const mk = (tag) => document.createElementNS(SVG_NS, tag);
    let add = (el) => { group.appendChild(el); return el; };
    const lineEl = (x1, y1, x2, y2, w = sw, strokeCategory = 'body') => {
        const ln = mk('line');
        setAttrs(ln, { x1, y1, x2, y2, 'stroke-width': w, fill: 'none' });
        applySymbolStroke(ln, strokeCategory);
        return add(ln);
    };
    const pathEl = (d, w = sw, strokeCategory = 'body') => {
        const p = mk('path');
        setAttrs(p, { d, 'stroke-width': w, fill: 'none' });
        applySymbolStroke(p, strokeCategory);
        return add(p);
    };
    const y = c.y, ax = c.x - 50, bx = c.x + 50, cx = c.x, cy = y;
    // Draw diodes into a rotated subgroup so built-in diodes are oriented correctly
    const drawGroup = mk('g');
    drawGroup.setAttribute('transform', `rotate(180 ${cx} ${cy})`);
    group.appendChild(drawGroup);
    add = (el) => { drawGroup.appendChild(el); return el; };
    const addArrow = (outward = true) => {
        const dir = outward ? 1 : -1, arrX = cx + (outward ? 10 : -10);
        pathEl(`M ${arrX} ${cy - 10} l ${6 * dir} -6 m -6 6 l ${6 * dir} 6`);
        pathEl(`M ${arrX} ${cy + 10} l ${6 * dir} -6 m -6 6 l ${6 * dir} 6`);
    };
    switch (String(subtype).toLowerCase()) {
        case 'tvs_bi':
            // Bidirectional TVS: two triangles pointing at each other, leads to 50 mil grid
            // Left cathode bar
            lineEl(ax, cy - 16, ax, cy + 16, sw, 'pin');
            // Left triangle
            pathEl(`M ${ax} ${cy} L ${ax + 16} ${cy - 16} L ${ax + 16} ${cy + 16} Z`);
            // Right triangle
            pathEl(`M ${bx} ${cy} L ${bx - 16} ${cy - 16} L ${bx - 16} ${cy + 16} Z`);
            // Right cathode bar
            lineEl(bx, cy - 16, bx, cy + 16, sw, 'pin');
            // Center connection between triangles
            lineEl(ax + 16, cy, bx - 16, cy, sw, 'body');
            break;
        case 'schottky':
            // Schottky diode: leads extended to 50 mil grid (ax and bx)
            // Anode lead
            lineEl(ax, cy, cx - 8, cy, sw, 'pin');
            // Diode triangle (anode side)
            pathEl(`M ${cx - 8} ${cy - 16} L ${cx + 16} ${cy} L ${cx - 8} ${cy + 16} Z`);
            // Cathode bar
            lineEl(cx + 16, cy - 16, cx + 16, cy + 16, sw, 'body');
            // Cathode lead
            lineEl(cx + 16, cy, bx, cy, sw, 'pin');
            // Schottky hooks
            pathEl(`M ${cx + 16} ${cy - 16} h 8 v 4`);
            pathEl(`M ${cx + 16} ${cy + 16} h -8 v -4`);
            break;
        default:
            // Standard diode: leads extended to 50 mil grid (ax and bx)
            // Anode lead
            lineEl(ax, cy, cx - 8, cy, sw, 'pin');
            // Diode triangle (anode side)
            pathEl(`M ${cx - 8} ${cy - 16} L ${cx + 16} ${cy} L ${cx - 8} ${cy + 16} Z`);
            // Cathode bar (touching the triangle point)
            lineEl(cx + 16, cy - 16, cx + 16, cy + 16, sw, 'body');
            // Cathode lead
            lineEl(cx + 16, cy, bx, cy, sw, 'pin');
            // Subtype adorners (adjusted for body center at cx)
            const bodyCenter = cx;
            switch (String(subtype).toLowerCase()) {
                case 'zener':
                    lineEl(bodyCenter - 6, cy - 6, bodyCenter + 6, cy, sw, 'body');
                    lineEl(bodyCenter - 6, cy + 6, bodyCenter + 6, cy, sw, 'body');
                    break;
                case 'led':
                    addArrow(true);
                    break;
                case 'photo':
                    addArrow(false);
                    break;
                case 'tunnel':
                    lineEl(bodyCenter - 2, cy - 12, bodyCenter - 2, cy + 12, sw, 'body');
                    break;
                case 'varactor':
                case 'varicap':
                    lineEl(bodyCenter + 16, cy - 12, bodyCenter + 16, cy + 12, sw, 'body');
                    break;
                case 'laser':
                    addArrow(true);
                    lineEl(bodyCenter + 22, cy - 14, bodyCenter + 22, cy + 14, sw, 'body');
                    break;
                case 'tvs_uni':
                    lineEl(bx, cy - 16, bx - 8, cy - 22, sw, 'body');
                    lineEl(bx, cy + 16, bx - 8, cy + 22, sw, 'body');
                    break;
            }
            break;
    }
}
function drawBattery(c, x, y, GRID, line, add) {
    const pinOffset = 2 * GRID;
    const xNeg = c.x - 10, xPos = c.x + 10;
    line(xNeg, y - 18, xNeg, y + 18, 'body');
    line(xNeg, y, c.x - pinOffset, y, 'pin');
    line(xPos, y - 12, xPos, y + 12, 'body');
    line(xPos, y, c.x + pinOffset, y, 'pin');
    const plusText = document.createElementNS(SVG_NS, 'text');
    setAttrs(plusText, {
        x: xNeg - 16, y: y - 8, 'text-anchor': 'end',
        'font-size': '16', 'font-weight': 'bold'
    });
    plusText.textContent = '+';
    applySymbolFill(plusText, 'pinText');
    add(plusText);
    const minusText = document.createElementNS(SVG_NS, 'text');
    setAttrs(minusText, {
        x: xPos + 16, y: y - 8, 'text-anchor': 'start',
        'font-size': '16', 'font-weight': 'bold'
    });
    minusText.textContent = '−';
    applySymbolFill(minusText, 'pinText');
    add(minusText);
}
function drawACSource(x, y, ax, bx, line, add, path) {
    const radius = 40;
    line(ax, y, x - radius, y, 'pin');
    line(x + radius, y, bx, y, 'pin');
    const circ = document.createElementNS(SVG_NS, 'circle');
    setAttrs(circ, {
        cx: x, cy: y, r: radius, fill: 'none',
        'stroke-width': '2'
    });
    applySymbolStroke(circ);
    add(circ);
    path(`M ${x - 30} ${y} q 15 -20 30 0 q 15 20 30 0`, 'body');
}
function drawTransistor(c, x, y, line, add) {
    const isNPN = c.type === 'npn';
    const bodyRadius = 36;
    const topBody = y - bodyRadius;
    const bottomBody = y + bodyRadius;
    const leftBody = x - bodyRadius;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', x.toString());
    circle.setAttribute('cy', y.toString());
    circle.setAttribute('r', bodyRadius.toString());
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', '2');
    applySymbolStroke(circle);
    add(circle);
    // Collector lead: external portion in pin color, internal portion in body color
    line(x, y - 50, x, topBody, 'pin');
    line(x, topBody, x, y - 28, 'body');
    // Emitter lead: same treatment
    line(x, y + 50, x, bottomBody, 'pin');
    line(x, bottomBody, x, y + 32, 'body');
    // Base electrode and connections
    line(x - 16, y - 20, x - 16, y + 20, 'body');
    line(x - 50, y, leftBody, y, 'pin');
    line(leftBody, y, x - 16, y, 'body');
    line(x - 16, y - 16, x, y - 28, 'body');
    line(x - 16, y + 16, x, y + 32, 'body');
    if (isNPN) {
        line(x - 1, y + 31, x - 9, y + 28);
        line(x - 1, y + 31, x - 4, y + 22);
    }
    else {
        line(x - 12, y + 20, x - 8, y + 28);
        line(x - 12, y + 20, x - 4, y + 24);
    }
}
function drawGround(x, y, line) {
    line(x - 16, y, x + 16, y, 'powerSymbol');
    line(x - 10, y + 6, x + 10, y + 6, 'powerSymbol');
    line(x - 4, y + 12, x + 4, y + 12, 'powerSymbol');
}
// ========================================================================================
// ===== WIRE RENDERING =====
// ========================================================================================
/**
 * Calculate dash array for stroke type.
 */
export function dashArrayFor(type) {
    switch (type) {
        case 'dashed': return '8 4';
        case 'dotted': return '2 4';
        default: return null;
    }
}
/**
 * Get effective stroke for a wire (explicit → netclass → theme).
 */
export function effectiveStroke(wire, netClass, theme) {
    if (wire.stroke)
        return wire.stroke;
    if (netClass?.wire)
        return netClass.wire;
    return theme.wire;
}
/**
 * Ensure wire has a stroke object (create from color if needed).
 */
export function ensureStroke(wire) {
    if (wire.stroke)
        return;
    if (wire.color && wire.color !== '#000000') {
        const match = wire.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1], 10) / 255;
            const g = parseInt(match[2], 10) / 255;
            const b = parseInt(match[3], 10) / 255;
            const a = match[4] ? parseFloat(match[4]) : 1;
            wire.stroke = {
                color: { r, g, b, a },
                width: 0.25,
                type: 'solid'
            };
        }
    }
}
// ========================================================================================
// ===== JUNCTION DOT RENDERING =====
// ========================================================================================
/**
 * Create SVG circle element for a junction dot.
 */
export function createJunctionDot(j, junctionDotSize, NET_CLASSES, rgba01ToCssFn) {
    const nc = NET_CLASSES[j.netId || 'default'] || NET_CLASSES.default;
    const sizeMils = junctionDotSize === 'smallest' ? 15 : junctionDotSize === 'small' ? 30 : junctionDotSize === 'default' ? 40 : junctionDotSize === 'large' ? 50 : 65;
    const diameterMm = sizeMils * 0.0254;
    const radiusMm = diameterMm / 2;
    const radiusPx = Math.max(1, radiusMm * (100 / 25.4));
    const color = j.color ? j.color : rgba01ToCssFn(nc.junction.color);
    const dot = document.createElementNS(SVG_NS, 'circle');
    setAttrs(dot, { cx: j.at.x, cy: j.at.y, r: radiusPx, fill: color, stroke: 'var(--bg)', 'stroke-width': '1' });
    return dot;
}
/**
 * Create SVG circle element for wire/component endpoint indicator.
 */
export function createEndpointCircle(pt, options) {
    let desiredScreenPx = 9;
    if (options.zoom <= 0.25)
        desiredScreenPx = 6;
    else if (options.zoom < 0.75)
        desiredScreenPx = 7;
    const scale = options.userScale();
    const widthUser = desiredScreenPx / Math.max(1e-6, scale);
    const circle = document.createElementNS(SVG_NS, 'circle');
    setAttrs(circle, {
        cx: pt.x,
        cy: pt.y,
        r: widthUser / 2,
        fill: 'rgba(0,200,0,0.08)',
        stroke: 'lime',
        'stroke-width': 1 / Math.max(1e-6, scale)
    });
    circle.setAttribute('data-endpoint', '1');
    circle.style.cursor = 'pointer';
    return circle;
}
// ========================================================================================
// ===== SELECTION OUTLINE =====
// ========================================================================================
/**
 * Update selection styling on component elements.
 * Helper function to check if an item is selected
 */
function isItemSelected(selection, kind, id) {
    return selection.items.some(item => item.kind === kind && item.id === id);
}
export function updateSelectionOutline(selection) {
    document.querySelectorAll('#components g.comp').forEach(g => {
        const id = g.getAttribute('data-id');
        if (!id)
            return;
        const on = isItemSelected(selection, 'component', id);
        g.classList.toggle('selected', !!on);
        // Highlight label or value text if selected
        const labelText = g.querySelector(`[data-label-for="${id}"]`);
        const valueText = g.querySelector(`[data-value-for="${id}"]`);
        if (labelText) {
            const labelSelected = isItemSelected(selection, 'label', id);
            if (labelSelected) {
                const original = labelText.getAttribute('fill');
                labelText.setAttribute('data-original-fill', original ?? '');
                labelText.style.fill = 'var(--accent)';
                labelText.style.fontWeight = 'bold';
            }
            else {
                const original = labelText.getAttribute('data-original-fill');
                if (original !== null) {
                    if (original === '')
                        labelText.removeAttribute('fill');
                    else
                        labelText.setAttribute('fill', normalizeSymbolColorForTheme(original));
                    labelText.removeAttribute('data-original-fill');
                }
                labelText.style.fill = '';
                labelText.style.fontWeight = 'normal';
            }
        }
        if (valueText) {
            const valueSelected = isItemSelected(selection, 'value', id);
            if (valueSelected) {
                const original = valueText.getAttribute('fill');
                valueText.setAttribute('data-original-fill', original ?? '');
                valueText.style.fill = 'var(--accent)';
                valueText.style.fontWeight = 'bold';
            }
            else {
                const original = valueText.getAttribute('data-original-fill');
                if (original !== null) {
                    if (original === '')
                        valueText.removeAttribute('fill');
                    else
                        valueText.setAttribute('fill', normalizeSymbolColorForTheme(original));
                    valueText.removeAttribute('data-original-fill');
                }
                valueText.style.fill = '';
                valueText.style.fontWeight = 'normal';
            }
        }
    });
    // Highlight selected junction dots
    document.querySelectorAll('[data-junction-id]').forEach(dot => {
        const jId = dot.getAttribute('data-junction-id');
        if (!jId)
            return;
        const selected = isItemSelected(selection, 'junction', jId);
        if (selected) {
            dot.setAttribute('stroke', 'var(--accent)');
            dot.setAttribute('stroke-width', '3');
        }
        else {
            dot.setAttribute('stroke', 'var(--bg)');
            dot.setAttribute('stroke-width', '1');
        }
    });
}
// ========================================================================================
// ===== DRAWING OVERLAY (WIRE IN PROGRESS) =====
// ========================================================================================
/**
 * Render the wire being drawn (active drawing state).
 */
export function renderDrawing(gDrawing, drawingPoints, cursor, orthoMode) {
    gDrawing.replaceChildren();
    if (drawingPoints.length === 0)
        return;
    const pts = [...drawingPoints];
    if (cursor && drawingPoints.length > 0) {
        const last = drawingPoints[drawingPoints.length - 1];
        if (orthoMode) {
            const dx = Math.abs(cursor.x - last.x);
            const dy = Math.abs(cursor.y - last.y);
            const snapPt = dx > dy ? { x: cursor.x, y: last.y } : { x: last.x, y: cursor.y };
            pts.push(snapPt);
        }
        else {
            pts.push(cursor);
        }
    }
    // Determine preview wire color using the same base setting as legacy wires.
    // Prefer CSS variable --wire; fallback to white/black depending on theme background.
    let previewColor = '#c7f284';
    try {
        const cssVar = getComputedStyle(document.documentElement).getPropertyValue('--wire').trim();
        if (cssVar)
            previewColor = cssVar;
        // If the resolved color is pure black, flip to white in dark mode for visibility.
        const bg = getComputedStyle(document.body).backgroundColor;
        const rgb = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
        const [r, g, b] = rgb;
        const srgb = [r / 255, g / 255, b / 255].map(v => (v <= 0.03928) ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
        const normalized = (previewColor || '').toLowerCase().replace(/\s+/g, '');
        if (normalized === '#000000' || normalized === '#000' || normalized === 'black') {
            previewColor = (L < 0.5) ? '#ffffff' : '#000000';
        }
    }
    catch {
        /* ignore environment issues; keep fallback */
    }
    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', previewColor);
    polyline.setAttribute('stroke-width', '2');
    polyline.setAttribute('stroke-dasharray', '4 2');
    gDrawing.appendChild(polyline);
    // Draw dots at each vertex
    for (const p of pts) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        setAttrs(circle, { cx: p.x, cy: p.y, r: 3, fill: previewColor });
        gDrawing.appendChild(circle);
    }
}
// ========================================================================================
// ===== PREVIEW JUNCTION DOT (WHILE DRAWING WIRE) =====
// ========================================================================================
/**
 * Create preview junction dot shown while drawing wire.
 */
export function createPreviewJunctionDot(at, junctionDotSize) {
    const sizeMils = junctionDotSize === 'smallest' ? 15 : junctionDotSize === 'small' ? 30 : junctionDotSize === 'default' ? 40 : junctionDotSize === 'large' ? 50 : 65;
    const diameterMm = sizeMils * 0.0254;
    const radiusMm = diameterMm / 2;
    const radiusPx = Math.max(1, radiusMm * (100 / 25.4));
    const previewDot = document.createElementNS(SVG_NS, 'circle');
    setAttrs(previewDot, {
        cx: at.x,
        cy: at.y,
        r: radiusPx,
        fill: 'rgba(255,255,255,0.6)',
        stroke: 'rgba(255,255,255,0.8)',
        'stroke-width': '1',
        'data-preview-junction': '1'
    });
    return previewDot;
}
//# sourceMappingURL=rendering.js.map