export function startFlow(flow, initial = flow.initial) {
  if (!flow.states.some(state => state.id === initial)) throw Error('Неизвестный шаг');
  return { current: initial, version: 1, approvedVersion: null, topic: '', workspaceRevision: 0, workspaceCheck: null, history: [] };
}
export function transition(flow, session, actionId) {
  const state = flow.states.find(state => state.id === session.current);
  const action = state?.actions.find(action => action.id === actionId);
  if (!action || !flow.states.some(state => state.id === action.to)) throw Error('Действие недоступно на этом шаге');
  if (flow.id === 'approval' && action.id === 'skip' && session.approvedVersion !== session.version) throw Error('Текущая версия ещё не согласована');
  const next = { ...session, current: action.to, history: [...session.history, { from: state.id, action: action.label, to: action.to }] };
  if (action.effect === 'approval') next.approvedVersion = session.version;
  if (action.effect === 'new-version') { next.version++; next.approvedVersion = null; }
  if (action.effect === 'topic') next.topic = 'Проверка обращения';
  if (action.effect === 'clear-topic') next.topic = '';
  if (action.effect === 'workspace-edit') next.workspaceCheck = null;
  if (['workspace-save', 'workspace-restore'].includes(action.effect)) { next.workspaceRevision++; next.workspaceCheck = null; }
  if (action.effect === 'workspace-typescript') next.workspaceCheck = 'TypeScript passed; ELMA not checked';
  if (action.effect === 'workspace-compiler') next.workspaceCheck = 'ELMA compiler passed (offline)';
  return next;
}
