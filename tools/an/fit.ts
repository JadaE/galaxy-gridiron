import { UID, MG, FS } from './ids';
import { loadBundle, pname } from '../../app/src/model';
import { rosterFit } from '../../app/src/fit';
import { NameIndex } from '../../app/src/chat/names';

const find=(b:any,n:string)=>Object.keys(b.players).filter(i=>b.players[i].n===n).sort((x,y)=>(b.me.players.includes(y)?1:0)-(b.me.players.includes(x)?1:0)||(b.proj[y]?1:0)-(b.proj[x]?1:0))[0];
(async()=>{
 const cases:Record<string,string[][]>={[MG]:[['Emanuel Wilson','Kyle Pitts'],['Cam Skattebo','Tre Tucker'],['Caleb Williams','Bryce Young'],['James Cook','Trey McBride']],[FS]:[['A.J. Brown','Jalen Coker'],['Breece Hall','Isaiah Likely'],['Joe Burrow','Drake Maye']]};
 for (const lid in cases){ const b=await loadBundle(lid,UID); console.log('==',b.league.name);
  for(const [x,y] of cases[lid]){ const t=Date.now(); const f=rosterFit(b,find(b,x),find(b,y)); console.log(`${x} ${f.a.pct}% vs ${y} ${f.b.pct}%  (gain ${f.a.avgGain.toFixed(2)}/${f.b.avgGain.toFixed(2)} starts ${f.a.startWeeks}/${f.b.startWeeks} of ${f.a.weeks}) ${Date.now()-t}ms`); f.reasons.forEach(r=>console.log('   -',r)); }
 }
})();
