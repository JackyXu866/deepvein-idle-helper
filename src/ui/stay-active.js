// The game marks the player "away" 60 s after its tab is hidden (it tells the
// server {t:"away"} and hides other players), and on return shows its
// "离线期间" summary. The helper keeps the page working in the background, so
// the game is shown a tab that is always visible: document.hidden is false,
// visibilityState is "visible", and visibilitychange never reaches the game's
// listeners. The helper keeps the real state (the browser still pauses the
// game's screen loop while hidden, which matters for the game's own join).
export function keepGameActive(win=window,doc=document) {
  const find=key=>{for(let o=doc;o;o=Object.getPrototypeOf(o)){const d=Object.getOwnPropertyDescriptor(o,key);if(d)return d;}return null;};
  const hiddenDesc=find('hidden'),stateDesc=find('visibilityState');
  const realHidden=()=>hiddenDesc?.get?hiddenDesc.get.call(doc):false;
  const realState=()=>stateDesc?.get?stateDesc.get.call(doc):'visible';
  const listeners=new Set();
  try {
    Object.defineProperty(doc,'hidden',{configurable:true,get:()=>false});
    Object.defineProperty(doc,'visibilityState',{configurable:true,get:()=>'visible'});
    // Capture on the window runs before any listener on the document.
    win.addEventListener('visibilitychange',event=>{
      event.stopImmediatePropagation();
      for(const fn of listeners)try {fn(event);} catch { /* One listener's error must not stop the others. */ }
    },true);
  } catch { /* Left as is: the game may mark the player away. */ }
  return {hidden:realHidden,state:realState,onChange:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
}
