import { loadBundle, pname, val, projOf, byeWeek, ppos } from '../../app/src/model';
import { rosterFit } from '../../app/src/fit';
(async()=>{ const b=await loadBundle((process.env.GG_LEAGUE_MG || '2000000000000000001'),(process.env.GG_USER_ID || '1000000000000000001'));
 const f=rosterFit(b,'7233' in b.players?Object.keys(b.players).find(i=>b.players[i].n==='Emanuel Wilson'&&b.me.players.includes(i))!:'',Object.keys(b.players).find(i=>b.players[i].n==='Kyle Pitts'&&b.proj[i])!);
 console.log(JSON.stringify(f,null,1));
 b.me.players.forEach(id=>console.log(pname(b,id),ppos(b,id),'val',val(b,id).toFixed(1),'proj',projOf(b,id).toFixed(1),'bye',byeWeek(b,id),b.players[id].i||''));
 console.log(b.slots, b.me.reserve);
})();
