'use strict';

const core=require('./page_motor_core');
const BROWSER_ONLY_ACTIONS=new Set(['back','forward','reload']);

class CanonicalMotorPlanner extends core.MotorPlanner{
  plan(intent,context={}){
    const action=String(intent?.type||'');
    if(BROWSER_ONLY_ACTIONS.has(action))throw new Error(`browser_ui_action_required:${action}`);
    return super.plan(intent,context);
  }
}

module.exports={
  ...core,
  MotorPlanner:CanonicalMotorPlanner,
  CanonicalMotorPlanner,
  BROWSER_ONLY_ACTIONS
};
