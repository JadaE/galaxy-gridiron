import { loadBundle, pname, ppos } from '../../app/src/model';
import { tradeIdeas } from '../../app/src/trades';
const UID=(process.env.GG_USER_ID || '1000000000000000001');
(async()=>{
 for (const lid of [(process.env.GG_LEAGUE_FS || '2000000000000000002'),(process.env.GG_LEAGUE_MG || '2000000000000000001')]) {
  const b = await loadBundle(lid, UID);
  const { ideas, mine } = tradeIdeas(b, {}, 10);
  console.log('\n==', b.league.name, 'week', b.week, 'teams', b.teams.length, 'slots', b.slots.join(','));
  console.log('my rel', JSON.stringify(mine!.rel), 'needs', mine!.needs, 'surplus', mine!.surplus);
  const dist: Record<string,number> = {};
  ideas.forEach(i=>i.give.forEach(g=>dist[pname(b,g)]=(dist[pname(b,g)]||0)+1));
  console.log('give dist', dist);
  ideas.forEach(i=>console.log(' ', i.team.display, 'give', i.give.map(g=>pname(b,g)+'('+b.fc![g]+')').join('+'), 'get', i.get.map(g=>pname(b,g)+'('+b.fc![g]+')'), 'net', Math.round(i.net), 'score', Math.round(i.score)));
  console.log('my roster:', b.me.players.map(id=>`${pname(b,id)} ${ppos(b,id)} fc=${b.fc?.[id]} val=${b.valuer.get(id).value.toFixed(1)} inj=${b.players[id]?.i||''}${b.me.starters.includes(id)?' *':''}`).join('\n  '));
 }
})().catch(e=>{console.error(e);process.exit(1)});
