import { cssToRGBA01 } from './utils.js';
const STORAGE_KEY = 'project.settings.v1';
const LEGACY_CLEARANCE_KEY = 'constraints.componentClearancePx';
const DEFAULT_SYMBOL_THEME = {
    body: cssToRGBA01('#202020'),
    pin: cssToRGBA01('#202020'),
    pinText: cssToRGBA01('#202020'),
    referenceText: cssToRGBA01('#202020'),
    valueText: cssToRGBA01('#202020'),
    powerSymbol: cssToRGBA01('#202020')
};
const DEFAULT_THEME = {
    background: '#e8e8e8',
    symbol: DEFAULT_SYMBOL_THEME
};
export const DEFAULT_THEME_BACKGROUND = DEFAULT_THEME.background;
export function getDefaultSymbolTheme() {
    return cloneSymbolTheme(DEFAULT_SYMBOL_THEME);
}
const DEFAULT_SETTINGS = {
    componentClearancePx: 0,
    theme: DEFAULT_THEME
};
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0;
    if (n <= 0)
        return 0;
    if (n >= 1)
        return 1;
    return n;
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
function cloneTheme(theme) {
    return {
        background: theme.background,
        symbol: cloneSymbolTheme(theme.symbol)
    };
}
function cloneSettings(settings) {
    return {
        componentClearancePx: settings.componentClearancePx,
        theme: cloneTheme(settings.theme)
    };
}
function normalizeRgba(input, fallback) {
    if (!input || typeof input !== 'object')
        return cloneRgba(fallback);
    const candidate = input;
    const r = candidate.r;
    const g = candidate.g;
    const b = candidate.b;
    const a = candidate.a;
    return {
        r: clamp01(typeof r === 'number' ? r : fallback.r),
        g: clamp01(typeof g === 'number' ? g : fallback.g),
        b: clamp01(typeof b === 'number' ? b : fallback.b),
        a: clamp01(typeof a === 'number' ? a : fallback.a)
    };
}
function normalizeSymbolTheme(input, fallback) {
    if (!input || typeof input !== 'object')
        return cloneSymbolTheme(fallback);
    const candidate = input;
    return {
        body: normalizeRgba(candidate.body, fallback.body),
        pin: normalizeRgba(candidate.pin, fallback.pin),
        pinText: normalizeRgba(candidate.pinText, fallback.pinText),
        referenceText: normalizeRgba(candidate.referenceText, fallback.referenceText),
        valueText: normalizeRgba(candidate.valueText, fallback.valueText),
        powerSymbol: normalizeRgba(candidate.powerSymbol, fallback.powerSymbol)
    };
}
function normalizeTheme(input, fallback) {
    if (!input || typeof input !== 'object')
        return cloneTheme(fallback);
    const candidate = input;
    return {
        background: typeof candidate.background === 'string' && candidate.background.trim().length > 0
            ? candidate.background.trim()
            : fallback.background,
        symbol: normalizeSymbolTheme(candidate.symbol, fallback.symbol)
    };
}
function normalizeSettings(input) {
    const fallback = DEFAULT_SETTINGS;
    if (!input || typeof input !== 'object')
        return cloneSettings(fallback);
    const candidate = input;
    const clearance = candidate.componentClearancePx;
    return {
        componentClearancePx: typeof clearance === 'number' && Number.isFinite(clearance) && clearance >= 0
            ? Math.max(0, Math.round(clearance))
            : fallback.componentClearancePx,
        theme: normalizeTheme(candidate.theme, fallback.theme)
    };
}
function readStorage(key) {
    try {
        if (typeof localStorage === 'undefined')
            return null;
        return localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
function writeStorage(key, value) {
    try {
        if (typeof localStorage === 'undefined')
            return;
        localStorage.setItem(key, value);
    }
    catch {
        /* ignore storage errors */
    }
}
let currentSettings = cloneSettings(DEFAULT_SETTINGS);
function setCurrent(settings, persist = true) {
    currentSettings = cloneSettings(settings);
    if (persist) {
        writeStorage(STORAGE_KEY, JSON.stringify(currentSettings));
        writeStorage(LEGACY_CLEARANCE_KEY, String(Math.max(0, Math.round(currentSettings.componentClearancePx))));
    }
    return cloneSettings(currentSettings);
}
function loadFromStorage() {
    const raw = readStorage(STORAGE_KEY);
    let parsed = null;
    if (raw) {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            parsed = null;
        }
    }
    let normalized = normalizeSettings(parsed);
    if (!raw) {
        const legacy = readStorage(LEGACY_CLEARANCE_KEY);
        if (legacy) {
            const n = Number.parseFloat(legacy);
            if (Number.isFinite(n) && n >= 0) {
                normalized = {
                    ...normalized,
                    componentClearancePx: Math.max(0, Math.round(n))
                };
            }
        }
    }
    return cloneSettings(normalized);
}
function applyPatch(base, patch) {
    if (!patch)
        return cloneSettings(base);
    const next = {
        componentClearancePx: base.componentClearancePx,
        theme: cloneTheme(base.theme)
    };
    if (patch.componentClearancePx !== undefined && Number.isFinite(patch.componentClearancePx)) {
        next.componentClearancePx = Math.max(0, Math.round(patch.componentClearancePx));
    }
    if (patch.theme) {
        if (typeof patch.theme.background === 'string' && patch.theme.background.trim().length > 0) {
            next.theme.background = patch.theme.background.trim();
        }
        if (patch.theme.symbol) {
            const symbol = patch.theme.symbol;
            if (symbol.body !== undefined)
                next.theme.symbol.body = normalizeRgba(symbol.body, next.theme.symbol.body);
            if (symbol.pin !== undefined)
                next.theme.symbol.pin = normalizeRgba(symbol.pin, next.theme.symbol.pin);
            if (symbol.pinText !== undefined)
                next.theme.symbol.pinText = normalizeRgba(symbol.pinText, next.theme.symbol.pinText);
            if (symbol.referenceText !== undefined)
                next.theme.symbol.referenceText = normalizeRgba(symbol.referenceText, next.theme.symbol.referenceText);
            if (symbol.valueText !== undefined)
                next.theme.symbol.valueText = normalizeRgba(symbol.valueText, next.theme.symbol.valueText);
            if (symbol.powerSymbol !== undefined)
                next.theme.symbol.powerSymbol = normalizeRgba(symbol.powerSymbol, next.theme.symbol.powerSymbol);
        }
    }
    return next;
}
export function initializeProjectSettings() {
    const loaded = loadFromStorage();
    return setCurrent(loaded, false);
}
export function getProjectSettings() {
    return cloneSettings(currentSettings);
}
export function setProjectSettings(settings) {
    const normalized = normalizeSettings(settings);
    return setCurrent(normalized, true);
}
export function updateProjectSettings(patch) {
    const merged = applyPatch(currentSettings, patch);
    return setCurrent(merged, true);
}
export function resetProjectSettings() {
    return setCurrent(DEFAULT_SETTINGS, true);
}
//# sourceMappingURL=projectSettings.js.map