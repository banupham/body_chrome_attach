'use strict';

const {modalityOf}=require('./habit_model');

class StrategyExecutor {
  constructor(habitModel,motorPlanner) {
    this.habitModel=habitModel;
    this.motorPlanner=motorPlanner;
  }

  choose(task,historyContext={}) {
    if(!task?.habitKey) throw new Error('habitKey_required');
    if(!Array.isArray(task.strategies)||!task.strategies.length) {
      throw new Error('strategies_required');
    }

    return this.habitModel.scoreAlternatives({
      habitKey:task.habitKey,
      alternatives:task.strategies,
      context:historyContext
    });
  }

  planSelected(selection,context={}) {
    const selected=selection?.selected?.alternative;
    if(!selected) throw new Error('no_strategy_selected');

    const actions=selected.actions||[];
    if(!actions.length) throw new Error('selected_strategy_has_no_actions');

    const steps=[];
    const subPlans=[];

    let localContext={...context};

    for(const action of actions) {
      const planned=this.motorPlanner.plan(action,localContext);
      subPlans.push({
        action,
        behaviorSource:planned.source,
        learnedGroup:planned.learnedGroup||null,
        learnedTemplateCount:planned.learnedTemplateCount||0
      });

      steps.push(...planned.plan.steps);

      const mouseSteps=planned.plan.steps.filter(s=>
        s.method==='Input.dispatchMouseEvent' &&
        Number.isFinite(Number(s.params?.x)) &&
        Number.isFinite(Number(s.params?.y))
      );
      const last=mouseSteps.at(-1);
      if(last) {
        localContext={
          ...localContext,
          pointerStart:{x:Number(last.params.x),y:Number(last.params.y)}
        };
      }
    }

    return {
      strategyId:selection.selected.id,
      modality:selection.selected.modality,
      score:selection.selected.score,
      decision:selection,
      subPlans,
      plan:{
        executionCapability:'HUMAN_MOTOR',
        actionType:'strategy',
        steps
      }
    };
  }
}

module.exports={StrategyExecutor};
