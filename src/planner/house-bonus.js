// House rooms' bonuses (client SP, YP, Gb, ni): each placed room of a kind
// adds level × bonusPerLevel × its rate; damage rooms cap at +50% each.
// `kinds`: one bonus kind or a list; `skill`: rooms tied to a skill match it.
export const DAMAGE_ROOM_CAP=.5;
export function houseBonus(data,p,kinds,skill=null) {
  const placed=p?.houseFurniture;
  if(!placed||!Object.keys(placed).length)return 0;
  const wanted=[kinds].flat(),per=data.houseRules?.bonusPerLevel??.01;
  let sum=0;
  for(const room of data.houseRooms??[]) {
    if(!wanted.includes(room.bonus?.kind)||!placed[room.id]||room.bonus.skill&&room.bonus.skill!==skill)continue;
    const bonus=(p.house?.[room.id]??0)*per*(room.rate??1);
    sum+=room.bonus.kind==='dmg'?Math.min(DAMAGE_ROOM_CAP,bonus):bonus;
  }
  return sum;
}
