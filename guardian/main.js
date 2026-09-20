'use strict';

const {GuardianRuntime}=require('./runtime');

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function main(){
  const check=process.argv.includes('--check');
  let stopping=false,current=null;
  const stop=()=>{stopping=true;try{current?.client?.close();}catch{}};
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);

  while(!stopping){
    current=new GuardianRuntime();
    try{
      const status=await current.start();
      console.log(JSON.stringify({component:'Guardian',state:'RUNNING',authorityOrder:status.authorityOrder,browserCount:status.browsers.length,decisionCount:Object.keys(status.decisions).length}));
      if(check){await current.stop();return 0;}
      await new Promise(resolve=>{
        const done=()=>resolve();
        current.client.once('disconnected',done);
        const poll=setInterval(()=>{if(stopping){clearInterval(poll);resolve();}},250);
        poll.unref?.();
      });
    }catch(error){
      console.error('[GUARDIAN]',String(error?.stack||error?.message||error));
      if(check)return 1;
    }finally{
      try{await current.stop();}catch{}
      current=null;
    }
    if(!stopping)await sleep(2000);
  }
  return 0;
}

if(require.main===module)main().then(code=>{process.exitCode=Number(code)||0;}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main,sleep};
