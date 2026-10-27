// Before/after give distribution for trade ideas (v0.0.2 vs v0.0.3), real league data.
import { loadBundle, pname } from '../../app/src/model';
import { tradeIdeas as v3 } from '../../app/src/trades';
import { tradeIdeas as v2 } from './trades_v002';
const UID=(process.env.GG_USER_ID || '1000000000000000001');
const dist=(b:any,ideas:any[])=>{const d:Record<string,number>={};ideas.forEach(i=>i.give.forEach((g:string)=>d[pname(b,g)]=(d[pname(b,g)]||0)+1));return Object.entries(d).sort((a,c)=>c[1]-a[1]).map(([k,v])=>`${k} ×${v}`).join(', ');};
(async()=>{
 for (const lid of [(process.env.GG_LEAGUE_FS || '2000000000000000002'),(process.env.GG_LEAGUE_MG || '2000000000000000001')]) {
  const b=await loadBundle(lid,UID);
  for (const [label,tags] of [['no tags',{}],['A.J. Brown 💎 high',{'5859':'high'}],['A.J. Brown 🔒 never',{'5859':'never'}]] as const) {
   if (lid!==(process.env.GG_LEAGUE_FS || '2000000000000000002') && label!=='no tags') continue;
   const a=v2(b,tags as any,10).ideas, c=v3(b,tags as any,10).ideas;
   console.log(`\n== ${b.league.name} [${label}]`);
   console.log(' v0.0.2 gives:', dist(b,a), ' | top-3:', a.slice(0,3).map((i:any)=>i.give.map((g:string)=>pname(b,g)).join('+')).join(' / '));
   console.log(' v0.0.3 gives:', dist(b,c), ' | top-3:', c.slice(0,3).map((i:any)=>i.give.map((g:string)=>pname(b,g)).join('+')).join(' / '));
   if (label==='no tags') c.forEach((i:any)=>console.log('   ',i.team.display,':',i.give.map((g:string)=>pname(b,g)).join(' + '),'→',pname(b,i.get[0]),'net',Math.round(i.net),i.note?'('+i.note+')':''));
  }
 }
})();
