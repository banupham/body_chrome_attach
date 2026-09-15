'use strict';

const SHORT_MAX_SECONDS=180;
const LEGACY_SHORT_MAX_SECONDS=60;
const THREE_MINUTE_SHORTS_START_MS=Date.parse('2024-10-15T00:00:00Z');
const FORMAT={SHORT:'SHORT',LONG_FORM:'LONG_FORM',UNKNOWN:'UNKNOWN'};

function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function parseIsoDurationSeconds(value){
  const text=String(value||'').trim();if(!text)return null;
  const m=/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(text);if(!m)return null;
  const days=Number(m[1]||0),hours=Number(m[2]||0),minutes=Number(m[3]||0),seconds=Number(m[4]||0),total=days*86400+hours*3600+minutes*60+seconds;
  return Number.isFinite(total)?total:null;
}
function playerAspect(player={}){const width=finite(player.embedWidth??player.width),height=finite(player.embedHeight??player.height);if(!(width>0&&height>0))return null;return Number((width/height).toFixed(4));}
function formatKind(value){const raw=typeof value==='string'?value:value?.kind;const kind=String(raw||'').toUpperCase();return kind===FORMAT.SHORT||kind===FORMAT.LONG_FORM?kind:FORMAT.UNKNOWN;}
function shortDurationLimit(publishedAt){const ms=Date.parse(String(publishedAt||''));if(!Number.isFinite(ms))return SHORT_MAX_SECONDS;return ms>=THREE_MINUTE_SHORTS_START_MS?SHORT_MAX_SECONDS:LEGACY_SHORT_MAX_SECONDS;}
function hasShortSignal(title='',descriptionExcerpt=''){return /(^|[\s,.;:()\[\]{}])#shorts?\b/i.test(`${String(title||'')} ${String(descriptionExcerpt||'')}`);}
function classifyMediaFormat({duration=null,publishedAt=null,player=null,title='',descriptionExcerpt='',routePath=''}={}){
  const durationSeconds=parseIsoDurationSeconds(duration),aspectRatio=playerAspect(player||{}),routeShort=/^\/shorts\//i.test(String(routePath||'')),shortSignal=hasShortSignal(title,descriptionExcerpt),limit=shortDurationLimit(publishedAt),evidence=[];
  if(routeShort)return {kind:FORMAT.SHORT,confidence:1,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence:['shorts_route']};
  if(durationSeconds!=null&&durationSeconds>SHORT_MAX_SECONDS){evidence.push('duration_over_180s');return {kind:FORMAT.LONG_FORM,confidence:0.99,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence};}
  if(aspectRatio!=null){
    if(aspectRatio>1.08){evidence.push('landscape_aspect');if(durationSeconds!=null)evidence.push(`duration_${Math.round(durationSeconds)}s`);return {kind:FORMAT.LONG_FORM,confidence:0.98,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence};}
    evidence.push('portrait_or_square_aspect');
    if(durationSeconds!=null&&durationSeconds<=limit){evidence.push(`duration_within_${limit}s_short_limit`);return {kind:FORMAT.SHORT,confidence:0.98,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence};}
    if(durationSeconds!=null&&durationSeconds>limit){evidence.push(`duration_over_${limit}s_short_limit`);return {kind:FORMAT.LONG_FORM,confidence:0.94,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence};}
  }
  if(shortSignal&&durationSeconds!=null&&durationSeconds<=limit){evidence.push('short_hashtag_signal',`duration_within_${limit}s_short_limit`);return {kind:FORMAT.SHORT,confidence:0.82,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence};}
  if(durationSeconds!=null)evidence.push(`duration_${Math.round(durationSeconds)}s`);if(shortSignal)evidence.push('short_hashtag_signal_without_geometry');
  return {kind:FORMAT.UNKNOWN,confidence:0.25,durationSeconds,aspectRatio,shortDurationLimit:limit,evidence};
}
function formatRelation(target,candidate){const a=formatKind(target),b=formatKind(candidate);if(a===FORMAT.UNKNOWN||b===FORMAT.UNKNOWN)return 'UNKNOWN';return a===b?'MATCH':'MISMATCH';}

module.exports={FORMAT,SHORT_MAX_SECONDS,LEGACY_SHORT_MAX_SECONDS,THREE_MINUTE_SHORTS_START_MS,parseIsoDurationSeconds,playerAspect,shortDurationLimit,classifyMediaFormat,formatKind,formatRelation};
