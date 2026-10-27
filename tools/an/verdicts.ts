import { loadBundle } from '../../app/src/model';
import { rules } from '../../app/src/chat/engine';
(async()=>{ const f=await loadBundle((process.env.GG_LEAGUE_FS || '2000000000000000002'),(process.env.GG_USER_ID || '1000000000000000001')); const m=await loadBundle((process.env.GG_LEAGUE_MG || '2000000000000000001'),(process.env.GG_USER_ID || '1000000000000000001'));
for (const [b,q] of [[f,'Burrow or Maye'],[m,'Wilson or Pitts Sr'],[m,'start Wilson or Skattebo'],[f,'AJ Brown or Coker']] as any) { const r=await rules.answer(q,{b,tags:{}}); console.log(q,'=>',r.verdict,'|',r.fit?.aPct,r.fit?.bPct); } })();
