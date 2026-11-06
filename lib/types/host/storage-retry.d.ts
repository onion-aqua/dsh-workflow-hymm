import type { KvTable } from '@deepseek-ai/dsh-storage-domain';
/** Exact pre-commit failure from rc.3 JSON's same-directory UUID temp rename. */
export declare function isWorkflowRenameBeforeCommit(error: unknown, platform?: NodeJS.Platform): boolean;
/**
 * Only retries an uncommitted Workflow metadata transform, never a native
 * action. rc.3 JSON putRecord rolls back on this rename error, and Domain's
 * table publishes its value only after putRecord succeeds. Both the caller
 * and the next table queue slot must still observe the original revision.
 */
export declare function updateWorkflowMetadata<T extends {
    revision: number;
}>(table: Pick<KvTable<string, T>, 'get' | 'update'>, id: string, transform: (current: T) => T, options?: {
    platform?: NodeJS.Platform;
    wait?: (milliseconds: number) => Promise<void>;
}): Promise<T>;
