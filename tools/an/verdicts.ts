import { UID, MG, FS } from './ids';
import { loadBundle } from '../../app/src/model';
import { rules } from '../../app/src/chat/engine';
(async()=>{ const f=await loadBundle(FS,UID); const m=await loadBundle(MG,UID);
for (const [b,q] of [[f,'Burrow or Maye'],[m,'Wilson or Pitts Sr'],[m,'start Wilson or Skattebo'],[f,'AJ Brown or Coker']] as any) { const r=await rules.answer(q,{b,tags:{}}); console.log(q,'=>',r.verdict,'|',r.fit?.aPct,r.fit?.bPct); } })();
