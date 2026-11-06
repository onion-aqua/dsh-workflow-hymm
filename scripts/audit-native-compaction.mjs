/** Read-only native audit. Stdout contains aggregates only; this script writes no files. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { parse } from 'yaml';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--home'||!args[1]?.trim()){
  process.stderr.write('Usage: node scripts/audit-native-compaction.mjs --home <explicit DSH home>\n');
  process.exitCode=2;
}else try{
  const home=resolve(args[1]),sessionRoot=join(home,'sessions');
  async function files(directory){
    const result=[];
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.isSymbolicLink())continue;
      const path=join(directory,entry.name);
      if(entry.isDirectory())result.push(...await files(path));
      else if(entry.isFile()&&/\.jsonl(?:\.zstd)?$/.test(entry.name))result.push(path);
    }
    return result.sort();
  }
  async function snapshot(){
    const result=new Map();
    for(const path of await files(sessionRoot))result.set(relative(sessionRoot,path),createHash('sha256').update(await readFile(path)).digest('hex'));
    return result;
  }
  function digest(entries){const hash=createHash('sha256');for(const [name,value] of [...entries].sort(([a],[b])=>a.localeCompare(b)))hash.update(name).update('\0').update(value).update('\n');return hash.digest('hex');}
  const before=await snapshot(),transactions=new Map(),sessionsWithCompaction=new Set();
  const counts={sessionFiles:before.size,decodedFiles:0,decodeFailures:0,rowsIncludingHeaders:0,eventRows:0,compactionStarts:0,compactionSummaries:0,compactionEnds:0,successfulEnds:0,failedEnds:0,compactionPrunes:0,manualStarts:0,automaticStarts:0,sessionsWithCompaction:0,contextRecords:0,usageRecords:0,maxContextWindow:0};
  for(const name of before.keys()){
    let rows;
    try{
      const input=await readFile(join(sessionRoot,name));let content=input;
      if(name.endsWith('.zstd')){
        // Native artifacts contain concatenated independent Zstandard frames.
        // The supported one-shot API returns one frame, so consume each frame.
        const chunks=[];let offset=0;
        while(offset<input.length){const decoded=zstdDecompressSync(input.subarray(offset),{info:true}),consumed=decoded.engine.bytesWritten;if(!Number.isSafeInteger(consumed)||consumed<=0)throw new Error('invalid frame');offset+=consumed;chunks.push(decoded.buffer);}
        content=Buffer.concat(chunks);
      }
      rows=content.toString('utf8').split('\n').filter(line=>line.trim()).map(line=>JSON.parse(line));counts.decodedFiles++;
    }catch{counts.decodeFailures++;continue;}
    for(const event of rows){
      counts.rowsIncludingHeaders++;if(event.type==='session/header'||event.version&&event.id&&event.data===undefined)continue;counts.eventRows++;
      const data=event.data??{},id=data.compactionId;
      if(event.type==='compaction/start'){
        counts.compactionStarts++;sessionsWithCompaction.add(name);if(data.turn===null)counts.manualStarts++;else counts.automaticStarts++;
        if(typeof id==='string')transactions.set(id,{...transactions.get(id),start:true,manual:data.turn===null});
      }else if(event.type==='compaction/summary'){counts.compactionSummaries++;if(typeof id==='string')transactions.set(id,{...transactions.get(id),summary:true});}
      else if(event.type==='compaction/prune')counts.compactionPrunes++;
      else if(event.type==='compaction/end'){
        counts.compactionEnds++;if(data.error)counts.failedEnds++;else counts.successfulEnds++;
        if(typeof id==='string'){
          // Classify a fixed vocabulary; never print the native error, which
          // can contain model text, private paths or provider diagnostics.
          const error=String(data.error??''),failure=/(?:max.tokens|MAX_TOKENS)/i.test(error)?'summary_output_limit':/produced no text summary|no text summary content/i.test(error)?'empty_summary':/summary is not smaller/i.test(error)?'summary_not_smaller':/context.window|CONTEXT_WINDOW/i.test(error)?'summary_context_limit':/abort|cancel/i.test(error)?'cancelled':/headroom|budget|contextWindow|no context capacity/i.test(error)?'configuration':/persist|durab|save/i.test(error)?'persistence':'other';
          transactions.set(id,{...transactions.get(id),end:true,success:!data.error,...data.error?{failure}:{}});
        }
      }else if(event.type==='request/context'){counts.contextRecords++;if(Number.isSafeInteger(data.contextWindow)&&data.contextWindow>0)counts.maxContextWindow=Math.max(counts.maxContextWindow,data.contextWindow);}
      else if(event.type==='assistant/message'&&data.usage)counts.usageRecords++;
    }
  }
  counts.sessionsWithCompaction=sessionsWithCompaction.size;
  const unique={transactions:transactions.size,successful:0,failed:0,incomplete:0,withSummary:0,manual:0,automatic:0,failureCategories:{}};
  for(const transaction of transactions.values()){
    if(transaction.summary)unique.withSummary++;
    if(transaction.start){if(transaction.manual)unique.manual++;else unique.automatic++;}
    if(!transaction.end)unique.incomplete++;else if(transaction.success)unique.successful++;else {unique.failed++;unique.failureCategories[transaction.failure]=(unique.failureCategories[transaction.failure]??0)+1;}
  }
  const routeIssues=[];
  let profileRead=false;
  try{
    const config=parse(await readFile(join(home,'profiles','desktop','cordis.patch.yml'),'utf8'));profileRead=true;
    const qwen=[],overrides=[];
    function visit(value){if(Array.isArray(value)){for(const item of value)visit(item);}else if(value&&typeof value==='object'){if(value.qwen&&typeof value.qwen==='object')qwen.push(...(Array.isArray(value.qwen.models)?value.qwen.models:[]));if(value.name==='@deepseek-ai/dsh-compaction-basic')overrides.push(value.config??{});for(const item of Object.values(value))visit(item);}}
    visit(config);
    for(const model of qwen){
      if(typeof model.id!=='string'||!/^[A-Za-z0-9._-]{1,160}$/.test(model.id)||!Number.isSafeInteger(model.contextWindow)||!Number.isSafeInteger(model.maxTokens))continue;
      const global=overrides.at(-1)??{},policy=global.modelPolicies?.find(item=>item.provider==='qwen'&&item.model===model.id),headroomTokens=policy?.headroomTokens??global.headroomTokens??65536;
      if(!Number.isSafeInteger(headroomTokens))continue;
      const pressureBudgetTokens=model.contextWindow-model.maxTokens-headroomTokens;
      // A profile row or the native default alone does not prove the retained
      // Agent Preset's effective engine config. Keep this a static risk; live
      // capability checks must read the actual Agent's scoped backend.
      if(pressureBudgetTokens<=0)routeIssues.push({provider:'qwen',model:model.id,contextWindow:model.contextWindow,maxTokens:model.maxTokens,headroomTokens,pressureBudgetTokens,issue:'potential_nonpositive_automatic_compaction_pressure_budget',effectivePresetVerified:false,headroomSource:policy?.headroomTokens!==undefined?'profile_model_policy':global.headroomTokens!==undefined?'profile_override':'unverified_rc3_native_default'});
    }
  }catch{/* Missing/unreadable profile is represented only as a Boolean. */}
  const after=await snapshot(),allNames=new Set([...before.keys(),...after.keys()]),changed=[...allNames].filter(name=>before.get(name)!==after.get(name));
  const result={checkedAt:new Date().toISOString(),harnessVersion:'0.2.1-rc.3',pluginVersion:'0.16.0',scope:'read-only native Session aggregates; no model calls; no raw errors, messages, Session identities, credentials or absolute profile paths emitted',counts,uniqueTransactions:unique,profile:{read:profileRead,routeIssues,modified:false},integrity:{algorithm:'sha256',beforeAggregate:digest(before),afterAggregate:digest(after),filesBefore:before.size,filesAfter:after.size,changedFiles:changed.length,unchanged:changed.length===0},limits:['Counts describe stored history, not a live model request.','Raw occurrence counts may include inherited records; unique transactions are deduplicated by their native compaction identity.','Native pressure warnings before compaction/start are not represented by a failed transaction.','Static route budget risks do not verify the compaction configuration of a retained Agent Preset generation.']};
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
}catch{
  // Never leak a filesystem path or model/provider payload via a caught stack.
  process.stderr.write('Native compaction audit failed while reading the explicitly selected home. No files were written.\n');process.exitCode=1;
}
