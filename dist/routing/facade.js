// A minimal default legacy kernel used as a safe compile-time/runtime default.
// This ensures the facade always has a legacy kernel (no null) until the real
// legacy adapter from `app.ts` is installed.
class DefaultLegacyKernel {
    constructor() {
        this.name = 'legacy';
    }
    init() { }
    dispose() { }
    manhattanPath(A, P, mode) {
        // Simple, deterministic L-shaped path: prefer the requested mode.
        if (Math.abs(A.x - P.x) < 1e-6)
            return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }];
        if (Math.abs(A.y - P.y) < 1e-6)
            return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }];
        if (mode === 'HV') {
            return [{ x: A.x, y: A.y }, { x: P.x, y: A.y }, { x: P.x, y: P.y }];
        }
        else {
            return [{ x: A.x, y: A.y }, { x: A.x, y: P.y }, { x: P.x, y: P.y }];
        }
    }
    snapToGridOrObject(pos, snapRadius) {
        // No snapping in default; real adapter will replace this.
        return { x: pos.x, y: pos.y };
    }
    beginPlacement(start, mode) {
        /* no-op */
    }
    updatePlacement(cursor) {
        return { preview: [] };
    }
    commitCorner() { return { points: [] }; }
    finishPlacement() { return { points: [] }; }
    cancelPlacement() { }
    setLineDrawingMode(_mode) {
        // legacy adapter / default kernel does not support this; no-op
    }
}
export class RoutingFacade {
    warnIfDefault(method) {
        if (!this.warnedDefault && this.isDefaultKernel) {
            this.warnedDefault = true;
            console.warn(`[RoutingFacade] DefaultLegacyKernel is still active (method: ${method}). ` +
                `app.ts should call routingFacade.setKernel(...) early during startup.`);
        }
    }
    constructor() {
        this.isDefaultKernel = true;
        this.warnedDefault = false;
        this.kernel = new DefaultLegacyKernel();
        this.isDefaultKernel = true;
        this.kernel.init?.();
    }
    setKernel(k) {
        if (this.kernel && this.kernel.dispose)
            this.kernel.dispose();
        this.kernel = k;
        this.isDefaultKernel = false;
        if (this.kernel.init)
            this.kernel.init();
    }
    getMode() {
        this.warnIfDefault('getMode');
        return this.kernel.name;
    }
    manhattanPath(A, P, mode) {
        this.warnIfDefault('manhattanPath');
        return this.kernel.manhattanPath(A, P, mode);
    }
    snapToGridOrObject(pos, snapRadius) {
        this.warnIfDefault('snapToGridOrObject');
        return this.kernel.snapToGridOrObject(pos, snapRadius);
    }
    // Wire placement lifecycle pass-throughs
    beginPlacement(start, mode) {
        this.warnIfDefault('beginPlacement');
        return this.kernel.beginPlacement(start, mode);
    }
    updatePlacement(cursor) {
        this.warnIfDefault('updatePlacement');
        return this.kernel.updatePlacement(cursor);
    }
    commitCorner() {
        this.warnIfDefault('commitCorner');
        return this.kernel.commitCorner();
    }
    finishPlacement() {
        this.warnIfDefault('finishPlacement');
        return this.kernel.finishPlacement();
    }
    cancelPlacement() {
        this.warnIfDefault('cancelPlacement');
        return this.kernel.cancelPlacement();
    }
    setLineDrawingMode(mode) {
        // Optional capability: only some kernels implement it.
        this.kernel.setLineDrawingMode?.(mode);
    }
}
// Export a singleton facade for easy import/use
export const routingFacade = new RoutingFacade();
//# sourceMappingURL=facade.js.map