import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line, Path, Circle, Defs, LinearGradient as SvgGrad, Stop, Text as SvgText, G } from 'react-native-svg';
import { C } from './theme';

export function Bars({ data, width, height = 170, valueFmt = (v: number) => v.toFixed(0) }: { data: { label: string; value: number; color?: string; hi?: boolean }[]; width: number; height?: number; valueFmt?: (v: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const padB = 22, padT = 16;
  const bw = width / Math.max(1, data.length);
  const h = height - padB - padT;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgGrad id="bhi" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={C.mint} /><Stop offset="1" stopColor={C.purple} /></SvgGrad>
        <SvgGrad id="blo" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#3A4370" /><Stop offset="1" stopColor="#262D4F" /></SvgGrad>
      </Defs>
      {data.map((d, i) => {
        const bh = (d.value / max) * h;
        const x = i * bw + bw * 0.18, w = bw * 0.64;
        return (
          <G key={i}>
            <Rect x={x} y={padT + h - bh} width={w} height={Math.max(2, bh)} rx={5} fill={d.color || (d.hi ? 'url(#bhi)' : 'url(#blo)')} />
            <SvgText x={x + w / 2} y={padT + h - bh - 4} fontSize={9} fill={d.hi ? C.mint : C.sub} textAnchor="middle" fontWeight={d.hi ? 'bold' : 'normal'}>{valueFmt(d.value)}</SvgText>
            <SvgText x={x + w / 2} y={height - 6} fontSize={9} fill={d.hi ? C.text : C.dim} textAnchor="middle" fontWeight={d.hi ? 'bold' : 'normal'}>{d.label}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

export function Lines({ series, labels, width, height = 180, yMin }: { series: { color: string; values: number[]; name: string; dashed?: boolean; area?: boolean }[]; labels: string[]; width: number; height?: number; yMin?: number }) {
  const all = series.flatMap(s => s.values).filter(v => Number.isFinite(v));
  if (!all.length) return <Text style={{ color: C.dim }}>No games yet</Text>;
  const max = Math.max(...all) * 1.08, min = yMin ?? Math.max(0, Math.min(...all) * 0.85);
  const padL = 28, padB = 20, padT = 10, padR = 8;
  const w = width - padL - padR, h = height - padB - padT;
  const n = Math.max(2, labels.length);
  const X = (i: number) => padL + (i / (n - 1)) * w;
  const Y = (v: number) => padT + h - ((v - min) / (max - min || 1)) * h;
  const ticks = [min, (min + max) / 2, max];
  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>{series.map((s, k) => <SvgGrad key={k} id={`ar${k}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={s.color} stopOpacity={0.35} /><Stop offset="1" stopColor={s.color} stopOpacity={0} /></SvgGrad>)}</Defs>
        {ticks.map((t, i) => (<G key={i}><Line x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3,4" /><SvgText x={padL - 4} y={Y(t) + 3} fontSize={9} fill={C.dim} textAnchor="end">{t.toFixed(0)}</SvgText></G>))}
        {labels.map((l, i) => <SvgText key={i} x={X(i)} y={height - 5} fontSize={9} fill={C.dim} textAnchor="middle">{l}</SvgText>)}
        {series.map((s, k) => {
          const pts = s.values.map((v, i) => [X(i), Y(v)] as const).filter(p => Number.isFinite(p[1]));
          if (!pts.length) return null;
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          return (
            <G key={k}>
              {s.area && pts.length > 1 ? <Path d={`${d} L${pts[pts.length - 1][0]},${padT + h} L${pts[0][0]},${padT + h} Z`} fill={`url(#ar${k})`} /> : null}
              <Path d={d} stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2.5} fill="none" strokeDasharray={s.dashed ? '5,4' : undefined} strokeLinejoin="round" />
              {!s.dashed && pts.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={3.2} fill={C.bg} stroke={s.color} strokeWidth={2} />)}
            </G>
          );
        })}
      </Svg>
      <View style={st.legend}>{series.map((s, k) => (<View key={k} style={st.li}><View style={[st.dot, { backgroundColor: s.color }]} /><Text style={st.lt}>{s.name}</Text></View>))}</View>
    </View>
  );
}

/** Mirrored horizontal bars: me (left, mint) vs opponent (right, magenta) per position. */
export function VersusBars({ rows, width }: { rows: { label: string; a: number; b: number }[]; width: number }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.a, r.b]));
  const mid = width / 2, lw = 34, half = mid - lw / 2 - 4;
  const rh = 26;
  return (
    <Svg width={width} height={rows.length * rh + 4}>
      {rows.map((r, i) => {
        const y = i * rh + 4;
        const aw = (r.a / max) * (half - 30), bw = (r.b / max) * (half - 30);
        const aWin = r.a >= r.b;
        return (
          <G key={i}>
            <Rect x={mid - lw / 2 - aw} y={y} width={Math.max(2, aw)} height={16} rx={4} fill={C.mint} opacity={aWin ? 1 : 0.45} />
            <Rect x={mid + lw / 2} y={y} width={Math.max(2, bw)} height={16} rx={4} fill={C.magenta} opacity={!aWin ? 1 : 0.45} />
            <SvgText x={mid} y={y + 12} fontSize={10} fill={C.text} textAnchor="middle" fontWeight="bold">{r.label}</SvgText>
            <SvgText x={mid - lw / 2 - aw - 4} y={y + 12} fontSize={10} fill={aWin ? C.mint : C.sub} textAnchor="end">{r.a.toFixed(1)}</SvgText>
            <SvgText x={mid + lw / 2 + bw + 4} y={y + 12} fontSize={10} fill={!aWin ? C.magenta : C.sub} textAnchor="start">{r.b.toFixed(1)}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

export function Ring({ pct, size = 74, color = C.mint, label }: { pct: number; size?: number; color?: string; label: string }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth={7} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={7} fill="none" strokeDasharray={`${c * p},${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }}>{label}</Text>
    </View>
  );
}

/** Win probability style tug-of-war bar */
export function TugBar({ a, b, width }: { a: number; b: number; width: number }) {
  const t = a + b || 1;
  const aw = Math.max(0.04, Math.min(0.96, a / t)) * width;
  return (
    <Svg width={width} height={12}>
      <Defs><SvgGrad id="tg" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={C.mint} /><Stop offset="1" stopColor="#4FE3D2" /></SvgGrad>
        <SvgGrad id="tg2" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={C.purple} /><Stop offset="1" stopColor={C.magenta} /></SvgGrad></Defs>
      <Rect x={0} y={0} width={width} height={12} rx={6} fill="url(#tg2)" />
      <Rect x={0} y={0} width={aw} height={12} rx={6} fill="url(#tg)" />
    </Svg>
  );
}

/** Picks: weekly win % bars (mint→purple when ≥50%, dim when below) with a gold cumulative-season line, 0-100 scale. */
export function PickChart({ weeks, width, height = 190, current }: { weeks: { w: number; pct: number | null; cum: number | null; n: number }[]; width: number; height?: number; current?: number }) {
  const padL = 30, padB = 22, padT = 14, padR = 8;
  const w = width - padL - padR, h = height - padB - padT;
  const n = Math.max(1, weeks.length), bw = w / n;
  const X = (i: number) => padL + i * bw + bw / 2;
  const Y = (v: number) => padT + h - (v / 100) * h;
  const line = weeks.map((x, i) => (x.cum == null ? null : [X(i), Y(x.cum * 100)] as const)).filter(Boolean) as (readonly [number, number])[];
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGrad id="pcHi" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={C.mint} /><Stop offset="1" stopColor={C.purple} /></SvgGrad>
          <SvgGrad id="pcLo" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={C.magenta} stopOpacity={0.75} /><Stop offset="1" stopColor="#3A2A6E" /></SvgGrad>
        </Defs>
        {[0, 50, 100].map(t => (<G key={t}><Line x1={padL} x2={width - padR} y1={Y(t)} y2={Y(t)} stroke={t === 50 ? C.sub : C.border} strokeWidth={1} strokeDasharray={t === 50 ? '4,3' : '3,5'} opacity={t === 50 ? 0.6 : 1} /><SvgText x={padL - 4} y={Y(t) + 3} fontSize={9} fill={C.dim} textAnchor="end">{t}%</SvgText></G>))}
        {weeks.map((x, i) => {
          const hi = x.w === current;
          const bh = x.pct == null ? 0 : (x.pct * 100 / 100) * h;
          return (
            <G key={x.w}>
              {x.pct == null ? <Rect x={X(i) - bw * 0.3} y={padT + h - 2} width={bw * 0.6} height={2} rx={1} fill={C.border} /> :
                <Rect x={X(i) - bw * 0.3} y={padT + h - bh} width={bw * 0.6} height={Math.max(2, bh)} rx={4} fill={x.pct >= 0.5 ? 'url(#pcHi)' : 'url(#pcLo)'} opacity={hi ? 1 : 0.88} stroke={hi ? C.text : 'none'} strokeWidth={hi ? 1 : 0} />}
              {x.pct != null && bw > 16 ? <SvgText x={X(i)} y={padT + h - bh - 4} fontSize={8.5} fill={C.sub} textAnchor="middle">{Math.round(x.pct * 100)}</SvgText> : null}
              <SvgText x={X(i)} y={height - 7} fontSize={9} fill={hi ? C.mint : C.dim} textAnchor="middle" fontWeight={hi ? 'bold' : 'normal'}>{x.w}</SvgText>
            </G>
          );
        })}
        {line.length > 1 ? <Path d={d} stroke={C.gold} strokeWidth={2.5} fill="none" strokeLinejoin="round" /> : null}
        {line.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={3} fill={C.bg} stroke={C.gold} strokeWidth={2} />)}
      </Svg>
      <View style={st.legend}>
        <View style={st.li}><View style={[st.dot, { backgroundColor: C.mint }]} /><Text style={st.lt}>Week win %</Text></View>
        <View style={st.li}><View style={[st.dot, { backgroundColor: C.gold }]} /><Text style={st.lt}>Season win % (running)</Text></View>
      </View>
    </View>
  );
}

/** Multi-person running win % lines on a fixed 0-100 axis (leaderboard). */
export function PctLines({ series, labels, width, height = 190 }: { series: { name: string; color: string; values: (number | null)[]; dashed?: boolean }[]; labels: string[]; width: number; height?: number }) {
  const padL = 30, padB = 20, padT = 10, padR = 10;
  const w = width - padL - padR, h = height - padB - padT;
  const all = series.flatMap(s => s.values).filter((v): v is number => v != null);
  const lo = all.length ? Math.max(0, Math.floor((Math.min(...all) * 100 - 8) / 10) * 10) : 0, hi = all.length ? Math.min(100, Math.ceil((Math.max(...all) * 100 + 8) / 10) * 10) : 100;
  const n = Math.max(2, labels.length);
  const X = (i: number) => padL + (i / (n - 1)) * w;
  const Y = (v: number) => padT + h - ((v * 100 - lo) / (hi - lo || 1)) * h;
  return (
    <View>
      <Svg width={width} height={height}>
        {[lo, (lo + hi) / 2, hi].map(t => (<G key={t}><Line x1={padL} x2={width - padR} y1={Y(t / 100)} y2={Y(t / 100)} stroke={C.border} strokeWidth={1} strokeDasharray="3,5" /><SvgText x={padL - 4} y={Y(t / 100) + 3} fontSize={9} fill={C.dim} textAnchor="end">{Math.round(t)}%</SvgText></G>))}
        {labels.map((l, i) => <SvgText key={i} x={X(i)} y={height - 5} fontSize={9} fill={C.dim} textAnchor="middle">{l}</SvgText>)}
        {series.map((s, k) => {
          const pts = s.values.map((v, i) => (v == null ? null : [X(i), Y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
          if (!pts.length) return null;
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          return (<G key={k}><Path d={d} stroke={s.color} strokeWidth={k === 0 ? 3 : 2.2} fill="none" strokeLinejoin="round" strokeDasharray={s.dashed ? '5,4' : undefined} />{pts.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={k === 0 ? 3.4 : 2.6} fill={C.bg} stroke={s.color} strokeWidth={2} />)}</G>);
        })}
      </Svg>
      <View style={st.legend}>{series.map((s, k) => (<View key={k} style={st.li}><View style={[st.dot, { backgroundColor: s.color }]} /><Text style={st.lt}>{s.name}</Text></View>))}</View>
    </View>
  );
}

const st = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4, paddingLeft: 28 },
  li: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lt: { color: C.sub, fontSize: 11 },
});
