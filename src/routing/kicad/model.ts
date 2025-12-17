export type KPoint = { x: number; y: number };

export type KWire = {
  id: string;
  points: KPoint[]; // polyline, treated as continuous conductor
};

export type KJunction = {
  id: string;
  at: KPoint;
};

export type KPinRef = {
  id: string; // unique pin identifier (e.g., compId:pinName)
  at: KPoint;
};

export type RoutingState = {
  wires: KWire[];
  junctions: KJunction[];
  pins: KPinRef[];
  tolerance: number; // distance tolerance for snapping/connection decisions
};

export type NetMember =
  | { kind: 'wire-endpoint'; wireId: string; endpointIndex: 0 | 1 }
  | { kind: 'pin'; pinId: string }
  | { kind: 'junction'; junctionId: string };

export type DerivedNet = {
  id: string;
  members: NetMember[];
};

export type Connectivity = {
  nets: DerivedNet[];
};
