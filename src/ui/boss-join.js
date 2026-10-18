// The game's own World Boss join control (upstream createNativeBoss controls):
// the top bar's "加入" pill, or the panel's run/attack button. Clicking it runs
// the game's whole join flow (supplies, walk, attack, restore), so the pill is
// valid while it says Join even before a nearby Boss entity has been received.
const visible=el=>!!el?.isConnected&&!el.hidden&&!el.disabled&&!el.closest?.('[hidden]')&&el.getClientRects?.().length>0;
const JOIN=/^(Join|加入|加入战斗)$/i;
const RUN=/^(Run to it|Attack|跑过去|攻击|前往|赶过去)$/i;

// The top bar's "加入" pill alone: the game's full join, usable from anywhere.
export function nativeBossJoinPill(document) {
  const pill=document?.querySelector?.('[data-boss-pill]');
  return visible(pill)&&JOIN.test(pill.querySelector?.('.boss-pill-join')?.textContent?.trim()??'')?pill:null;
}

// What that join sends on its own (client b2/Nv): set the work aside, join,
// take supplies, walk, attack, deliver, and resume afterwards.
export const NATIVE_JOIN_FLOW=new Set(['setAside','joinWorldBoss','raidSupply','deliverToBoss','walk','attackWorldBoss','leaveWorldBoss','skip','startQueued']);

// The game's own leave button, which also restores the set-aside work.
export function nativeBossLeave(document) {
  const button=document?.querySelector?.('[data-boss-leave]');
  return visible(button)?button:null;
}

export function nativeBossJoinControl(document) {
  const pill=document?.querySelector?.('[data-boss-pill]'),run=document?.querySelector?.('[data-boss-run]');
  if(visible(pill)&&JOIN.test(pill.querySelector?.('.boss-pill-join')?.textContent?.trim()??''))return pill;
  if(visible(run)&&RUN.test(run.textContent?.trim()??''))return run;
  return null;
}
