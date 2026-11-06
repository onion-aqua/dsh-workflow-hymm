import type { NativeSessionLog } from './native-runtime.ts';
/** Exact native user/message replacement seqs whose full compaction transaction closed successfully. */
export declare function verifiedCompactionCheckpoints(log: NativeSessionLog): ReadonlySet<number>;
/** Keep a completed task's native idle compaction suffix when it contains no new task input. */
export declare function compactionContinuationBoundary(log: NativeSessionLog, completedTurnEndSeq: number): number;
