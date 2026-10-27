import { loadBundle, pname } from '../../app/src/model';
(async()=>{ const b = await loadBundle((process.env.GG_LEAGUE_FS || '2000000000000000002'),(process.env.GG_USER_ID || '1000000000000000001'));
 const id = b.me.players.find(i=>pname(b,i)==='A.J. Brown')!; const v=b.valuer.get(id);
 console.log(id, b.players[id], 'proj', b.proj[id], 'season', b.season_[id]);
 console.log(v.weeks.map(w=>`${w.w}:${w.played?w.pts.toFixed(1):'-'}${w.team||''}`).join(' '), 'games', v.games, 'median', v.median, 'value', v.value);
 const tx=b.tx.filter(t=>t.adds&&id in t.adds); console.log(tx.map(t=>[t.type,t.status,new Date(t.status_updated).toISOString(),t.adds[id]]));
 console.log('me rid', b.me.rid, 'roster size', b.me.players.length, b.league.roster_positions.length);
})();
