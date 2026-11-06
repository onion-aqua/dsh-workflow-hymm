import type { Rectangle } from './graph.ts';

export interface QuestionPanelAnchor { key:string;anchor:Rectangle;width?:number;height?:number }
export interface QuestionPanelPlacement extends Rectangle { key:string }
export interface QuestionPanelInsets { top:number;right:number;bottom:number;left:number }

function overlap(a:Rectangle,b:Rectangle):number{
  return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
}
function distance(a:Rectangle,b:Rectangle):number{
  const dx=Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width),dy=Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height);
  return dx*dx+dy*dy;
}

/** Screen-space overlays only. Every input rectangle and graph coordinate stays unchanged. */
export function placeQuestionPanels(anchors:readonly QuestionPanelAnchor[],viewport:{width:number;height:number},obstacles:readonly Rectangle[],insets:Partial<QuestionPanelInsets>={}):QuestionPanelPlacement[]{
  const gap=16;
  const left=Math.max(0,Math.min(insets.left??12,Math.max(0,viewport.width-1)));
  const top=Math.max(0,Math.min(insets.top??12,Math.max(0,viewport.height-1)));
  const right=Math.max(left+1,viewport.width-Math.max(0,insets.right??12));
  const bottom=Math.max(top+1,viewport.height-Math.max(0,insets.bottom??12));
  const placed:QuestionPanelPlacement[]=[];
  for(const item of anchors){
    const width=Math.max(1,Math.min(item.width??380,right-left)),height=Math.max(1,Math.min(item.height??320,bottom-top));
    const blocked=[...obstacles,item.anchor,...placed];
    const nearby=[...blocked].sort((a,b)=>distance(a,item.anchor)-distance(b,item.anchor)).slice(0,24);
    const clampX=(x:number)=>Math.max(left,Math.min(x,right-width));
    const clampY=(y:number)=>Math.max(top,Math.min(y,bottom-height));
    const xs=new Set([left,right-width,item.anchor.x+item.anchor.width+gap,item.anchor.x-width-gap,item.anchor.x+(item.anchor.width-width)/2]);
    const ys=new Set([top,bottom-height,item.anchor.y,item.anchor.y+item.anchor.height+gap,item.anchor.y-height-gap,item.anchor.y+(item.anchor.height-height)/2]);
    for(const obstacle of nearby){xs.add(obstacle.x-width-gap);xs.add(obstacle.x+obstacle.width+gap);ys.add(obstacle.y-height-gap);ys.add(obstacle.y+obstacle.height+gap);}
    let best:Rectangle|undefined,bestOverlap=Infinity,bestDistance=Infinity;
    for(const x of xs)for(const y of ys){
      const candidate={x:clampX(x),y:clampY(y),width,height};
      let covered=0;
      for(const node of blocked){
        covered+=overlap(candidate,node);
        // Headers and connection handles carry actions, so protect them first
        // when a densely packed canvas has no completely empty rectangle.
        covered+=overlap(candidate,{x:node.x-4,y:node.y-4,width:node.width+8,height:38})*4;
        covered+=overlap(candidate,{x:node.x-13,y:(node.portY??node.y+node.height/2)-13,width:26,height:26})*3;
        covered+=overlap(candidate,{x:node.x+node.width-13,y:(node.portY??node.y+node.height/2)-13,width:26,height:26})*3;
      }
      const proximity=distance(candidate,item.anchor)+((candidate.x+width/2)-(item.anchor.x+item.anchor.width/2))**2*.01+((candidate.y+height/2)-(item.anchor.y+item.anchor.height/2))**2*.01;
      if(covered<bestOverlap||covered===bestOverlap&&proximity<bestDistance){best=candidate;bestOverlap=covered;bestDistance=proximity;}
    }
    placed.push({...best!,key:item.key});
  }
  return placed;
}
