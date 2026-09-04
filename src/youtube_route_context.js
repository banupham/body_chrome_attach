'use strict';

function clean(value){return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();}
function currentSearchQuery(locationRef=globalThis.location){
  try{
    const href=String(locationRef?.href||'');if(!href)return '';
    const u=new URL(href,'https://www.youtube.com/');
    if(u.pathname!=='/results')return '';
    return clean(u.searchParams.get('search_query')||'');
  }catch{return '';}
}
function enrichObservationRoute(observation,locationRef=globalThis.location){
  if(!observation||typeof observation!=='object')return observation;
  const route=observation.route&&typeof observation.route==='object'?observation.route:{};
  return {...observation,route:{...route,searchQuery:currentSearchQuery(locationRef)}};
}

module.exports={clean,currentSearchQuery,enrichObservationRoute};
