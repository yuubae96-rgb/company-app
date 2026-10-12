/* Rail routing on MLIT N02 2024 geometry, CC BY 4.0.
   https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2024.html
   Line graphs join only at named interchange stations, never at crossings. */
(()=>{'use strict';
const km=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111.195;
const normalize=n=>String(n||'').trim().replace(/駅$/u,'');
const project=(c,a,b)=>{const scale=Math.cos(c[1]*Math.PI/180),dx=(b[0]-a[0])*scale,dy=b[1]-a[1],t=Math.max(0,Math.min(1,((c[0]-a[0])*scale*dx+(c[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]};
let cached,data,loading;
const base=document.currentScript?.src||location.href;
async function load(){if(data)return;if(loading)return loading;loading=Promise.all(DATA_FILES.map(async file=>{const response=await fetch(new URL(file+'?v=20261012-national31',base),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('全国の鉄道データを読み込めませんでした。もう一度準備してください。');return response.json()})).then(parts=>{data={lines:{},stations:[],meta:{}};for(const part of parts){Object.assign(data.lines,part.lines);Object.assign(data.meta,part.meta||{});data.stations.push(...part.stations)}}).finally(()=>{loading=null});return loading;}

function build(){if(cached)return cached;const nodes=new Map(),adj=new Map(),stationNodes=[],lineEdges=new Map();
 const add=(id,c)=>{if(!nodes.has(id)){nodes.set(id,c);adj.set(id,[])}};
 const connect=(a,b,line,transfer=false)=>{if(a===b)return;const meters=km(nodes.get(a),nodes.get(b))*1000,high=line.includes('新幹線'),cost=meters/(high?260000:data.meta[line]?.jr?80000:45000)+(transfer?.15:0);const edge={meters,cost,line,high,transfer};adj.get(a).push({to:b,...edge});adj.get(b).push({to:a,...edge})};
 for(const [line,ways] of Object.entries(data.lines)){const edges=[],grid=new Map();lineEdges.set(line,{edges,grid});for(const coords of ways)for(let i=1;i<coords.length;i++){const a=coords[i-1],b=coords[i],u=line+'|'+a.join(','),v=line+'|'+b.join(',');add(u,a);add(v,b);connect(u,v,line);const edge={a,b,u,v};edges.push(edge);for(let x=Math.floor(Math.min(a[0],b[0])*20);x<=Math.floor(Math.max(a[0],b[0])*20);x++)for(let y=Math.floor(Math.min(a[1],b[1])*20);y<=Math.floor(Math.max(a[1],b[1])*20);y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(edge)}}}
 for(const station of data.stations){const index=lineEdges.get(station.line);if(!index)continue;const edges=new Set(),x=Math.floor(station.coord[0]*20),y=Math.floor(station.coord[1]*20);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const e of index.grid.get((x+dx)+','+(y+dy))||[])edges.add(e);let best=null,d=Infinity;for(const e of edges){const c=project(station.coord,e.a,e.b),distance=km(c,station.coord);if(distance<d){d=distance;best={...e,c}}}if(!best||d>.5)continue;const id='station|'+station.line+'|'+station.name+'|'+station.coord.join(',');add(id,best.c);connect(id,best.u,station.line);connect(id,best.v,station.line);stationNodes.push({...station,id,coord:best.c})}
 const groups=new Map();for(const station of stationNodes){if(!groups.has(station.name))groups.set(station.name,[]);groups.get(station.name).push(station)}
 for(const group of groups.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){const a=group[i],b=group[j];if(km(a.coord,b.coord)<.6)connect(a.id,b.id,a.line===b.line?a.line:'乗換',a.line!==b.line)}
 return cached={nodes,adj,stationNodes};
}
function candidates(p,graph,allowHigh){const available=graph.stationNodes.filter(s=>allowHigh||!s.line.includes('新幹線'));const exact=available.filter(s=>s.name===normalize(p.name)&&km(s.coord,p.coord)<2);if(exact.length)return exact;let nearest=null,d=Infinity;for(const s of available){const n=km(p.coord,s.coord);if(n<d){d=n;nearest=s}}return d<1.5?available.filter(s=>s.name===nearest.name&&km(s.coord,nearest.coord)<.6):[]}
function route(a,b,allowHigh){const graph=build(),from=candidates(a,graph,allowHigh),to=candidates(b,graph,allowHigh);if(!from.length||!to.length)return null;const goals=new Set(to.map(s=>s.id)),dist=new Map(),prev=new Map(),heap=[];
 const push=(d,k)=>{let i=heap.length;heap.push([d,k]);while(i>0){const p=(i-1)>>1;if(heap[p][0]<=d)break;heap[i]=heap[p];i=p}heap[i]=[d,k]};
 const pop=()=>{const result=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c}heap[i]=last}return result};
 for(const s of from){dist.set(s.id,0);push(0,s.id)}let target;
 while(heap.length){const [d,u]=pop();if(d!==dist.get(u))continue;if(goals.has(u)){target=u;break}for(const edge of graph.adj.get(u)){if(!allowHigh&&edge.high)continue;const nd=d+edge.cost;if(nd<(dist.get(edge.to)??Infinity)){dist.set(edge.to,nd);prev.set(edge.to,{from:u,edge});push(nd,edge.to)}}}
 if(!target)throw Error('この2地点をつなぐ鉄道経路が見つかりません。経由駅や移動手段を確認してください。');
 const path=[];let at=target;while(prev.has(at)){const p=prev.get(at);path.push({from:p.from,to:at,edge:p.edge});at=p.from}path.reverse();if(!path.length)throw Error('出発駅と目的地が同じです');
 const legs=[],transfers=[];for(const p of path){const edge=p.edge,coord=graph.nodes.get(p.to),start=graph.nodes.get(p.from),kind=edge.high?'shinkansen':'local';if(edge.transfer){const station=graph.stationNodes.find(s=>s.id===p.from);const arrival=graph.stationNodes.find(s=>s.id===p.to);if(station&&arrival&&station.line.includes('新幹線')!==arrival.line.includes('新幹線')&&!transfers.includes(station.name+'駅'))transfers.push(station.name+'駅');}
 let leg=legs.at(-1);if(!leg||leg.trainType!==kind||leg.line!==edge.line){leg={mode:'rail',trainType:kind,line:edge.line,coords:[start],meters:0,usedProfile:'mlit-network',highSpeed:[],labels:[]};legs.push(leg)}leg.coords.push(coord);leg.meters+=edge.meters;}
 for(const leg of legs){if(leg.trainType==='shinkansen')leg.highSpeed=[leg.coords];const seen=new Set();leg.labels=graph.stationNodes.filter(s=>s.line===leg.line&&!seen.has(s.name)&&leg.coords.some(c=>km(c,s.coord)<.35)&&km(s.coord,a.coord)>.5&&km(s.coord,b.coord)>.5).map(s=>{seen.add(s.name);return {name:s.name+'駅',coord:s.coord,mode:'rail'}});if(leg.labels.length>24){const step=Math.ceil(leg.labels.length/24);leg.labels=leg.labels.filter((label,i)=>i%step===0||transfers.includes(label.name))}leg.transfers=transfers;}
 return {mode:'rail',coords:legs.flatMap(l=>l.coords),meters:legs.reduce((s,l)=>s+l.meters,0),subLegs:legs};
}
function search(q){const name=normalize(q),list=data.stations.filter(s=>s.name===name),result=[];for(const s of list){const existing=result.find(p=>km(p.coord,s.coord)<.6);if(existing){if(!existing.detail.includes(s.line))existing.detail+='／'+s.line;continue}result.push({name:name+'駅',coord:s.coord,detail:s.line})}return result}
window.RailNetwork={route:async(a,b,high)=>{await load();return route(a,b,high)},search:async q=>{await load();return search(q)}};
// Geometry simplified within 5 meters; section endpoints retained.
// Geometry simplified within 5 meters; section endpoints retained.
const DATA_FILES=["rail-network-data-00.json", "rail-network-data-01.json", "rail-network-data-02.json", "rail-network-data-03.json", "rail-network-data-04.json", "rail-network-data-05.json", "rail-network-data-06.json", "rail-network-data-07.json"];
})();