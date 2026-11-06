import { Fragment, type ReactNode } from 'react';
import { marked } from 'marked';
import './markdown-content.css';

/** Render links as links only for protocols that do not execute code or open local files. */
export function safeMarkdownHref(value:string):string|null {
  const href=value.trim();
  if(/[\u0000-\u0020\u007f]/.test(href))return null;
  try { const url=new URL(href);return ['https:','http:','mailto:'].includes(url.protocol)?href:null; } catch { return null; }
}

interface MarkdownToken {
  type:string;raw?:string;text?:string;tokens?:MarkdownToken[];depth?:number;
  href?:string;title?:string|null;lang?:string;ordered?:boolean;start?:number;
  items?:MarkdownToken[];task?:boolean;checked?:boolean;
  header?:MarkdownToken[];rows?:MarkdownToken[][];align?:('left'|'center'|'right'|null)[];
}

function decodeEntities(value:string):string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/gi,entity=>{
    const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"};
    const found=named[entity.toLowerCase()];if(found!==undefined)return found;
    const point=entity[2]?.toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);
    return Number.isFinite(point)&&point>0&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff)?String.fromCodePoint(point):'�';
  });
}

function renderTokens(tokens:MarkdownToken[],depth=0):ReactNode {
  if(depth>50)return null;
  const children=(token:MarkdownToken)=>token.tokens?renderTokens(token.tokens,depth+1):decodeEntities(token.text??'');
  return tokens.map((token,index)=>{
    let node:ReactNode;
    switch(token.type){
      case 'space':return null;
      case 'heading': { const Tag=`h${Math.min(6,Math.max(1,token.depth??2))}` as 'h1';node=<Tag>{children(token)}</Tag>;break; }
      case 'paragraph':node=<p>{children(token)}</p>;break;
      case 'text':case 'escape':node=children(token);break;
      case 'strong':node=<strong>{children(token)}</strong>;break;
      case 'em':node=<em>{children(token)}</em>;break;
      case 'del':node=<s>{children(token)}</s>;break;
      case 'codespan':node=<code>{decodeEntities(token.text??'')}</code>;break;
      case 'code':node=<pre><code data-language={token.lang?.split(/\s/)[0]}>{token.text}</code></pre>;break;
      case 'br':node=<br/>;break;
      case 'hr':node=<hr/>;break;
      case 'blockquote':node=<blockquote>{children(token)}</blockquote>;break;
      case 'link': {const href=safeMarkdownHref(token.href??'');node=href?<a href={href} title={token.title??undefined} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{children(token)}</a>:<span>{children(token)}</span>;break;}
      // Images are described without fetching remote resources from untrusted session text.
      case 'image':node=<span className="wf-markdown-image" title={token.href}>▧ {decodeEntities(token.text||token.title||'Image')}</span>;break;
      case 'html':node=token.raw??token.text;break;
      case 'list': {const Tag=token.ordered?'ol':'ul';node=<Tag start={token.ordered?token.start:undefined}>{(token.items??[]).map((item,i)=><li key={i}>{item.task&&<input type="checkbox" checked={!!item.checked} readOnly disabled tabIndex={-1}/ >}{children(item)}</li>)}</Tag>;break;}
      case 'table':node=<div className="wf-markdown-table"><table><thead><tr>{(token.header??[]).map((cell,i)=><th key={i} style={{textAlign:token.align?.[i]??undefined}}>{children(cell)}</th>)}</tr></thead><tbody>{(token.rows??[]).map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} style={{textAlign:token.align?.[j]??undefined}}>{children(cell)}</td>)}</tr>)}</tbody></table></div>;break;
      default:node=token.tokens?children(token):decodeEntities(token.text??token.raw??'');
    }
    return <Fragment key={index}>{node}</Fragment>;
  });
}

/** Markdown token tree -> React, with no raw HTML injection and no automatic image loads. */
export function MarkdownContent({source,className=''}:{source:string;className?:string}) {
  return <div className={`wf-markdown-content ${className}`.trim()}>{renderTokens(marked.lexer(source,{gfm:true,breaks:true}) as unknown as MarkdownToken[])}</div>;
}
