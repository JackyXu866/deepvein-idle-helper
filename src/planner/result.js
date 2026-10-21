// The shape every planner, market and boss decision returns: an intent to send
// (null while waiting), a short label and the reason shown to the player.
export const action=(intent,label,reason='',extra={})=>({intent,label,reason,...extra});
export const waiting=(label,reason='',extra={})=>action(null,label,reason,extra);
