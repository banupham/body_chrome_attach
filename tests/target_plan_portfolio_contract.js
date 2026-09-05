'use strict';

const assert=require('node:assert/strict');
const {currentSearchQuery,enrichObservationRoute}=require('../src/youtube_route_context');
const {inferDomains,channelCentroidQuery,forbiddenDirectQuery,buildTargetPlanPortfolio,buildTargetFingerprint,scoreTargetProximity,comparePlanResults,commandCountOf}=require('../research/target_plan_portfolio');

assert.equal(currentSearchQuery({href:'https://www.youtube.com/results?search_query=b%E1%BA%A5t+%C4%91%E1%BB%99ng+s%E1%BA%A3n&sp=abc'}),'bất động sản');
assert.equal(currentSearchQuery({href:'https://www.youtube.com/watch?v=abc'}),'');
const enriched=enrichObservationRoute({route:{pageType:'search',path:'/results'}},{href:'https://www.youtube.com/results?search_query=nh%C3%A0+%C4%91%E1%BA%A5t'});
assert.equal(enriched.route.searchQuery,'nhà đất');

const target={videoId:'qXy0iyni-xk',title:'💥Khu dân cư mới Cầu tràm 5x28m SHR đường rộng ô tô tránh nhau hướng ĐNT 2tỷ750-3tỷ150',categoryId:'22',tags:[],keywords:[{term:'khu',score:3,sources:['title']},{term:'dân',score:3,sources:['title']}],topicLabels:[],channel:{country:'VN',keywords:['NHÀ ĐẸP BÌNH CHÁNH','NHÀ BÌNH CHÁNH GIÁ RẺ','BÁN NHÀ BÌNH CHÁNH','NHÀ BÌNH CHÁNH CHÍNH CHỦ','MINH NGỌC NHÀ BÌNH CHÁNH','bán nhà chợ đệm bình chánh'],topicLabels:['Hobby','Lifestyle (sociology)','Knowledge']}};
const domains=inferDomains(target);
assert.equal(domains[0].id,'real_estate');
assert.match(channelCentroidQuery(target),/nha|binh|chanh/i);
const plans=buildTargetPlanPortfolio(target,{trackVideoId:target.videoId,budget:8});
assert.ok(plans.length>=4);
assert.ok(plans.some(x=>x.id==='domain_cluster_real_estate'&&x.query==='bất động sản'));
assert.ok(plans.some(x=>x.traversal==='cluster_deepening'));
assert.ok(plans.some(x=>x.traversal==='cross_topic'));
for(const plan of plans){assert.equal(forbiddenDirectQuery(plan.query,target,target.videoId),false);assert.notEqual(plan.query,target.title);assert.notEqual(plan.query,target.videoId);}

const fp=buildTargetFingerprint(target);
const nearby={videoId:'near1',title:'Bán nhà Bình Chánh sổ hồng riêng giá tốt',categoryId:'22',keywords:[{term:'nhà đất'}],topicLabels:[],channel:{country:'VN',keywords:['bán nhà bình chánh','nhà đất'],topicLabels:['Knowledge','Lifestyle (sociology)']}};
const unrelated={videoId:'far1',title:'Hot girl dance cực vui',categoryId:'22',keywords:[{term:'dance'}],topicLabels:[],channel:{country:'VN',keywords:['dance','hot girl'],topicLabels:['Hobby','Lifestyle (sociology)']}};
const nearScore=scoreTargetProximity(nearby,fp).score,farScore=scoreTargetProximity(unrelated,fp).score;
assert.ok(nearScore>farScore,`expected target-cluster listing ${nearScore} > unrelated lifestyle ${farScore}`);

const comparison=comparePlanResults([
  {plan:{id:'p3',query:'x',traversal:'natural'},evaluation:{found:true,bestRoute:{graphEdgeCount:4,rank:2},closestObserved:null,elapsedMs:1000,commandCount:10}},
  {plan:{id:'p2',query:'y',traversal:'cluster_deepening'},evaluation:{found:true,bestRoute:{graphEdgeCount:2,rank:9},closestObserved:null,elapsedMs:2000,commandCount:12}},
  {plan:{id:'p1',query:'z',traversal:'cross_topic'},evaluation:{found:false,bestRoute:null,closestObserved:{proximity:{score:.8}},elapsedMs:500,commandCount:5}}
]);
assert.equal(comparison.shortestFoundPlan,'p2');
assert.equal(comparison.rankedPlans[0].planId,'p2');
assert.equal(comparison.comparisonMode,'shared_session_operational');

assert.equal(commandCountOf({commandIds:['a','b','c']}),3);
assert.equal(commandCountOf({commandIds:[]}),0);
assert.equal(commandCountOf({}),0,'missing commandIds must not crash plan execution');
assert.equal(commandCountOf(null),0,'null runner must be safe');

console.log('target_plan_portfolio_contract: PASS');
