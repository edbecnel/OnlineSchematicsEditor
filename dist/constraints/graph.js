/**
 * Entity-Constraint Graph
 * Manages relationships between entities and constraints
 */
export class ConstraintGraph {
    constructor() {
        // Core data structures
        this.entities = new Map();
        this.constraints = new Map();
        // Adjacency maps for fast lookups
        this.entityToConstraints = new Map();
        this.constraintToEntities = new Map();
    }
    // ====== Entity Management ======
    addEntity(entity) {
        this.entities.set(entity.id, entity);
        if (!this.entityToConstraints.has(entity.id)) {
            this.entityToConstraints.set(entity.id, new Set());
        }
    }
    getEntity(id) {
        return this.entities.get(id);
    }
    removeEntity(id) {
        // Remove entity from all constraints
        const constraintIds = this.entityToConstraints.get(id);
        if (constraintIds) {
            for (const cid of constraintIds) {
                this.unlinkEntityFromConstraint(id, cid);
            }
        }
        this.entities.delete(id);
        this.entityToConstraints.delete(id);
    }
    getAllEntities() {
        return Array.from(this.entities.values());
    }
    updateEntityPosition(id, position) {
        const entity = this.entities.get(id);
        if (entity) {
            entity.position = { ...position };
        }
    }
    // ====== Constraint Management ======
    addConstraint(constraint) {
        this.constraints.set(constraint.id, constraint);
        // Link constraint to its entities
        if (!this.constraintToEntities.has(constraint.id)) {
            this.constraintToEntities.set(constraint.id, new Set());
        }
        for (const entityId of constraint.entities) {
            this.linkEntityToConstraint(entityId, constraint.id);
        }
    }
    getConstraint(id) {
        return this.constraints.get(id);
    }
    removeConstraint(id) {
        const entityIds = this.constraintToEntities.get(id);
        if (entityIds) {
            for (const eid of entityIds) {
                this.unlinkEntityFromConstraint(eid, id);
            }
        }
        this.constraints.delete(id);
        this.constraintToEntities.delete(id);
    }
    getAllConstraints() {
        return Array.from(this.constraints.values());
    }
    enableConstraint(id) {
        const constraint = this.constraints.get(id);
        if (constraint) {
            constraint.enabled = true;
        }
    }
    disableConstraint(id) {
        const constraint = this.constraints.get(id);
        if (constraint) {
            constraint.enabled = false;
        }
    }
    // ====== Query Operations ======
    /**
     * Get all constraints affecting a specific entity
     */
    getConstraintsForEntity(entityId) {
        const constraintIds = this.entityToConstraints.get(entityId);
        if (!constraintIds)
            return [];
        return Array.from(constraintIds)
            .map(id => this.constraints.get(id))
            .filter((c) => c !== undefined && c.enabled);
    }
    /**
     * Get all entities affected by a specific constraint
     */
    getEntitiesForConstraint(constraintId) {
        const entityIds = this.constraintToEntities.get(constraintId);
        if (!entityIds)
            return [];
        return Array.from(entityIds)
            .map(id => this.entities.get(id))
            .filter((e) => e !== undefined);
    }
    /**
     * Find all constraints of a specific type
     */
    getConstraintsByType(type) {
        return Array.from(this.constraints.values())
            .filter(c => c.type === type && c.enabled);
    }
    /**
     * Find entities of a specific type
     */
    getEntitiesByType(type) {
        return Array.from(this.entities.values())
            .filter(e => e.type === type);
    }
    /**
     * Get all entities within a certain distance of a point
     */
    getEntitiesNear(point, radius) {
        return Array.from(this.entities.values())
            .filter(e => {
            const dx = e.position.x - point.x;
            const dy = e.position.y - point.y;
            return Math.sqrt(dx * dx + dy * dy) <= radius;
        });
    }
    /**
     * Check if two entities are connected by constraints
     */
    areConnected(entityId1, entityId2) {
        const constraints1 = this.entityToConstraints.get(entityId1);
        const constraints2 = this.entityToConstraints.get(entityId2);
        if (!constraints1 || !constraints2)
            return false;
        // Check if they share any constraints
        for (const cid of constraints1) {
            if (constraints2.has(cid))
                return true;
        }
        return false;
    }
    /**
     * Find shortest path between two entities through constraints
     */
    findPath(fromEntityId, toEntityId) {
        // BFS to find shortest path
        const visited = new Set();
        const queue = [
            { entity: fromEntityId, path: [fromEntityId] }
        ];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current.entity === toEntityId) {
                return current.path;
            }
            if (visited.has(current.entity))
                continue;
            visited.add(current.entity);
            // Find connected entities through shared constraints
            const constraints = this.entityToConstraints.get(current.entity);
            if (!constraints)
                continue;
            for (const cid of constraints) {
                const entities = this.constraintToEntities.get(cid);
                if (!entities)
                    continue;
                for (const eid of entities) {
                    if (!visited.has(eid)) {
                        queue.push({
                            entity: eid,
                            path: [...current.path, eid]
                        });
                    }
                }
            }
        }
        return null; // No path found
    }
    // ====== Bulk Operations ======
    /**
     * Remove all temporary constraints
     */
    clearTemporaryConstraints() {
        const toRemove = [];
        for (const [id, constraint] of this.constraints) {
            if (constraint.metadata?.temporary) {
                toRemove.push(id);
            }
        }
        toRemove.forEach(id => this.removeConstraint(id));
    }
    /**
     * Clear all entities and constraints
     */
    clear() {
        this.entities.clear();
        this.constraints.clear();
        this.entityToConstraints.clear();
        this.constraintToEntities.clear();
    }
    /**
     * Get statistics about the graph
     */
    getStats() {
        let totalConstraintsPerEntity = 0;
        for (const constraintSet of this.entityToConstraints.values()) {
            totalConstraintsPerEntity += constraintSet.size;
        }
        let totalEntitiesPerConstraint = 0;
        for (const entitySet of this.constraintToEntities.values()) {
            totalEntitiesPerConstraint += entitySet.size;
        }
        return {
            entityCount: this.entities.size,
            constraintCount: this.constraints.size,
            avgConstraintsPerEntity: this.entities.size > 0
                ? totalConstraintsPerEntity / this.entities.size
                : 0,
            avgEntitiesPerConstraint: this.constraints.size > 0
                ? totalEntitiesPerConstraint / this.constraints.size
                : 0
        };
    }
    // ====== Private Helper Methods ======
    linkEntityToConstraint(entityId, constraintId) {
        // Add constraint to entity's set
        let entityConstraints = this.entityToConstraints.get(entityId);
        if (!entityConstraints) {
            entityConstraints = new Set();
            this.entityToConstraints.set(entityId, entityConstraints);
        }
        entityConstraints.add(constraintId);
        // Add entity to constraint's set
        let constraintEntities = this.constraintToEntities.get(constraintId);
        if (!constraintEntities) {
            constraintEntities = new Set();
            this.constraintToEntities.set(constraintId, constraintEntities);
        }
        constraintEntities.add(entityId);
        // Update entity's constraint set
        const entity = this.entities.get(entityId);
        if (entity) {
            entity.constraints.add(constraintId);
        }
    }
    unlinkEntityFromConstraint(entityId, constraintId) {
        // Remove constraint from entity's set
        const entityConstraints = this.entityToConstraints.get(entityId);
        if (entityConstraints) {
            entityConstraints.delete(constraintId);
        }
        // Remove entity from constraint's set
        const constraintEntities = this.constraintToEntities.get(constraintId);
        if (constraintEntities) {
            constraintEntities.delete(entityId);
        }
        // Update entity's constraint set
        const entity = this.entities.get(entityId);
        if (entity) {
            entity.constraints.delete(constraintId);
        }
    }
}
//# sourceMappingURL=graph.js.map