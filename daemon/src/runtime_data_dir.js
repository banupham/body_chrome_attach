'use strict';

const path=require('node:path');

function configuredRuntimeDataDir(env=process.env){
  const raw=String(env?.BODY_RUNTIME_DATA_DIR||'').trim();
  return raw?path.resolve(raw):null;
}

function runtimeDataDir(fallback,env=process.env){
  return configuredRuntimeDataDir(env)||path.resolve(fallback);
}

function runtimeDataPath(fallback,suffix=[],env=process.env){
  const root=configuredRuntimeDataDir(env);
  if(!root)return path.resolve(fallback);
  const parts=Array.isArray(suffix)?suffix:[suffix];
  return path.join(root,...parts.map(String));
}

module.exports={configuredRuntimeDataDir,runtimeDataDir,runtimeDataPath};
