import { loadBundle } from '../../app/src/model';
import { buildContext } from '../../app/src/ai/context';
(async()=>{ for (const lid of [(process.env.GG_LEAGUE_FS || '2000000000000000002'),(process.env.GG_LEAGUE_MG || '2000000000000000001')]) { const b=await loadBundle(lid,(process.env.GG_USER_ID || '1000000000000000001')); const c=buildContext(b,{'5859':'high'},{mentioned:b.me.players.slice(0,2)}); const s=JSON.stringify(c); console.log(b.league.name, s.length, 'bytes', Object.keys(c).join(',')); if(lid.startsWith('138')) console.log(s.slice(0,1500)); } })();
