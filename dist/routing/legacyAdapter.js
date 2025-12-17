// Legacy adapter wraps existing legacy implementations by delegating to provided callbacks.
export class LegacyRoutingKernelAdapter {
    constructor(impl) {
        this.name = 'legacy';
        this.impl = impl;
    }
    manhattanPath(A, P, mode) {
        return this.impl.manhattanPath(A, P, mode);
    }
    snapToGridOrObject(pos, snapRadius) {
        return this.impl.snapToGridOrObject(pos, snapRadius);
    }
}
//# sourceMappingURL=legacyAdapter.js.map