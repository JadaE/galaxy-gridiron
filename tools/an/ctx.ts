import { UID, MG, FS } from './ids';
import { loadBundle } from '../../app/src/model';
import { buildContext } from '../../app/src/ai/context';
(async()=>{ for (const lid of [FS,MG]) { const b=await loadBundle(lid,UID); const c=buildContext(b,{'5859':'high'},{mentioned:b.me.players.slice(0,2)}); const s=JSON.stringify(c); console.log(b.league.name, s.length, 'bytes', Object.keys(c).join(',')); if(lid===MG) console.log(s.slice(0,1500)); } })();
