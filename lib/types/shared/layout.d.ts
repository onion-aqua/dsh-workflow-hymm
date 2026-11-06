/** Geometry only: dependency layout never changes task identity or graph edges. */
export interface LayoutNode {
    id: string;
    position: {
        x: number;
        y: number;
    };
    width?: number;
    height?: number;
}
export interface LayoutEdge {
    source: string;
    target: string;
}
/** Longest-path layers, with stable neighbour ordering to keep parallel paths together. */
export declare function layoutDependencyNodes<T extends LayoutNode>(nodes: readonly T[], edges: readonly LayoutEdge[]): T[];
/** Place only a new graph, preserving every existing manually positioned card.
 * Find the first free vertical translation using obstacle intervals rather than
 * extending an unrelated existing canvas into one long horizontal row. */
export declare function placeNewDependencyNodes<T extends LayoutNode>(nodes: readonly T[], edges: readonly LayoutEdge[], existing: readonly LayoutNode[]): T[];
