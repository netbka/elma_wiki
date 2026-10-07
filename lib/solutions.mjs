import path from 'node:path';
import { projectStore } from './projects.mjs';
import { managedWorkspaceStore } from './managed-workspace-store.mjs';

// A separate root is the admission boundary. Legacy private records are never
// looked up here, and this server-only principal is never selected by clients.
export const SOLUTION_CATALOG = 'shared-solution-catalog-v1';
export function solutionStore(directory) {
  const root = path.resolve(directory, 'shared-solutions');
  // Match the existing 50 Solutions x 100 captured artifacts lifecycle limit.
  const uploads = projectStore(root, { maxProjects: 5000 });
  return { uploads, managed: managedWorkspaceStore(root, uploads) };
}
