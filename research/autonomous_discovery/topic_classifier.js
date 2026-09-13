'use strict';

const CATEGORY_TOPIC=Object.freeze({
  '1':'entertainment','2':'automotive','10':'music','15':'lifestyle','17':'sports','19':'travel','20':'gaming',
  '22':'lifestyle','23':'entertainment','24':'entertainment','25':'news','26':'lifestyle','27':'education','28':'technology','29':'society'
});

const RULES=Object.freeze([
  {topic:'real_estate',terms:['bất động sản','bat dong san','nhà đất','nha dat','đất nền','dat nen','căn hộ','can ho','chung cư','chung cu','real estate','property','bán nhà','ban nha','bán đất','ban dat','sổ hồng','so hong']},
  {topic:'finance',terms:['tài chính','tai chinh','chứng khoán','chung khoan','cổ phiếu','co phieu','đầu tư','dau tu','ngân hàng','ngan hang','crypto','bitcoin','forex','finance','stock market']},
  {topic:'business',terms:['kinh doanh','business','entrepreneur','marketing','sales','startup','doanh nghiệp','doanh nghiep','thương mại','thuong mai']},
  {topic:'gaming',terms:['gaming','gameplay','gamer','esports','minecraft','roblox','valorant','pubg','free fire','liên quân','lien quan','league of legends','fortnite','genshin','game']},
  {topic:'sports',terms:['bóng đá','bong da','football','soccer','sports','thể thao','the thao','nba','basketball','tennis','premier league','champions league','motogp','formula 1','f1']},
  {topic:'technology',terms:['công nghệ','cong nghe','technology','tech','smartphone','laptop','computer','pc build','gpu','cpu','artificial intelligence','trí tuệ nhân tạo','tri tue nhan tao','programming','coding']},
  {topic:'news',terms:['tin tức','tin tuc','thời sự','thoi su','news','chính trị','chinh tri','breaking news']},
  {topic:'music',terms:['nhạc','nhac','music','remix','song','ca sĩ','ca si','lyrics','karaoke','lofi','edm','dj','ballad','playlist','album','official audio']},
  {topic:'education',terms:['giáo dục','giao duc','education','học tập','hoc tap','bài học','bai hoc','tutorial','course','lecture','study','exam']},
  {topic:'travel',terms:['du lịch','du lich','travel','tour','hotel','khách sạn','khach san','flight','resort','destination']},
  {topic:'automotive',terms:['ô tô','o to','xe hơi','xe hoi','car review','automotive','motorcycle','xe máy','xe may','supercar','tesla']},
  {topic:'health_fitness',terms:['sức khỏe','suc khoe','health','fitness','gym','workout','nutrition','yoga','medical','doctor','bác sĩ','bac si']},
  {topic:'food',terms:['ẩm thực','am thuc','food','cooking','recipe','món ăn','mon an','restaurant','street food','ăn uống','an uong']},
  {topic:'science',terms:['science','khoa học','khoa hoc','space','vũ trụ','vu tru','physics','chemistry','biology','research']},
  {topic:'kids_family',terms:['kids','children','baby','family','trẻ em','tre em','thiếu nhi','thieu nhi','nursery rhyme']},
  {topic:'entertainment',terms:['entertainment','comedy','funny','movie','film','trailer','celebrity','showbiz','reaction']}
]);

function clean(value){return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();}
function fold(value){return clean(value).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');}
function uniq(values){return [...new Set((values||[]).map(clean).filter(Boolean))];}
function topicLabel(url){
  const raw=String(url||'').trim();if(!raw)return null;
  try{const u=new URL(raw);return decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1)||'').replace(/_/g,' ')||null;}catch{return raw;}
}
function keywordTerms(api){return uniq((api?.keywords||[]).map(x=>x?.term||x));}
function evidenceText(node={}){
  const api=node.youtubeApi||node;
  return fold([
    node.title,api.title,...(api.tags||[]),...keywordTerms(api),...(api.topicLabels||[]),
    ...(api.channel?.keywords||[]),...(api.channel?.topicLabels||[]),api.descriptionExcerpt
  ].filter(Boolean).join(' | '));
}
function containsTerm(text,term){
  const needle=fold(term);if(!needle)return false;
  if(/^[a-z0-9]{2,4}$/.test(needle)){
    const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,'i').test(text);
  }
  return text.includes(needle);
}
function classifyVideo(node={}){
  const api=node.youtubeApi||node;
  const text=evidenceText(node),scores=new Map(),evidence=new Map();
  const add=(topic,score,why)=>{scores.set(topic,(scores.get(topic)||0)+score);const rows=evidence.get(topic)||[];if(why&&!rows.includes(why))rows.push(why);evidence.set(topic,rows);};
  const categoryTopic=CATEGORY_TOPIC[String(api.categoryId||'')];
  if(categoryTopic)add(categoryTopic,3.2,`category:${api.categoryId}`);
  for(const label of uniq([...(api.topicLabels||[]),...(api.channel?.topicLabels||[])])){
    const normalized=fold(label);
    for(const rule of RULES)if(rule.terms.some(term=>containsTerm(normalized,term)))add(rule.topic,2.4,`topic:${label}`);
  }
  for(const rule of RULES){
    let hits=0;
    for(const term of rule.terms)if(containsTerm(text,term)){hits++;if(hits<=4)add(rule.topic,1.0,`term:${term}`);}
    if(hits>=2)add(rule.topic,Math.min(2.5,(hits-1)*0.45),`multi_term:${hits}`);
  }
  const ranked=[...scores.entries()].map(([topic,score])=>({topic,score:Number(score.toFixed(3)),evidence:(evidence.get(topic)||[]).slice(0,8)})).sort((a,b)=>b.score-a.score||a.topic.localeCompare(b.topic));
  if(!ranked.length)return {primary:'unknown',confidence:0,secondary:[],scores:[],evidence:[]};
  const total=ranked.reduce((sum,row)=>sum+Math.max(0,row.score),0)||1;
  const primary=ranked[0];
  const confidence=Math.max(0,Math.min(1,primary.score/(primary.score+2.2)));
  return {
    primary:primary.topic,
    confidence:Number(confidence.toFixed(3)),
    secondary:ranked.slice(1,4).map(row=>({topic:row.topic,confidence:Number(Math.min(1,row.score/(row.score+2.8)).toFixed(3))})),
    scores:ranked.slice(0,8),
    evidence:primary.evidence
  };
}

function topicDistance(a,b){
  const aa=typeof a==='string'?a:classifyVideo(a).primary,bb=typeof b==='string'?b:classifyVideo(b).primary;
  if(!aa||!bb||aa==='unknown'||bb==='unknown')return 0.55;
  return aa===bb?0:1;
}

module.exports={CATEGORY_TOPIC,RULES,clean,fold,uniq,topicLabel,evidenceText,classifyVideo,topicDistance};
