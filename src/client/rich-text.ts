import { Extension, Node, type Extensions } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Plugin } from '@tiptap/pm/state';
import { Lexer, Marked, type Token, type TokensList, type marked } from 'marked';
import { safeMarkdownHref } from './MarkdownContent.tsx';

/** Keep HTML source as literal text, before Tiptap's HTML fallback can parse it. */
function literalHtml<T extends Token[]>(tokens:T):T {
  for(let i=0;i<tokens.length;i++){
    const token=tokens[i]!;
    if(token.type==='html'){
      const text={type:'text',raw:token.raw,text:token.raw} as Token;
      tokens[i]=token.block?{type:'paragraph',raw:token.raw,text:token.raw,tokens:[text]} as Token:text;
    }
    else {
      if('tokens' in token&&Array.isArray(token.tokens))literalHtml(token.tokens);
      if(token.type==='list')for(const item of token.items)literalHtml(item.tokens);
      if(token.type==='table')for(const cell of [...token.header,...token.rows.flat()])literalHtml(cell.tokens);
    }
  }
  return tokens;
}
class LiteralHtmlLexer<ParserOutput=string,RendererOutput=string> extends Lexer<ParserOutput,RendererOutput> {
  override lex(source:string):TokensList{return literalHtml(super.lex(source));}
  override inlineTokens(source:string,tokens?:Token[]):Token[]{return literalHtml(super.inlineTokens(source,tokens));}
}

/** Image metadata survives Markdown edits without loading the referenced image. */
const ImagePlaceholder=Node.create({
  name:'image',inline:true,group:'inline',atom:true,
  addAttributes(){return {raw:{default:''},alt:{default:''},source:{default:''},title:{default:''}};},
  parseHTML(){return [{tag:'span[data-workflow-image]'}];},
  renderHTML({node}){return ['span',{'data-workflow-image':'true',class:'wf-markdown-image',contenteditable:'false',title:node.attrs.source},`▧ ${node.attrs.alt||'Image'}`];},
  markdownTokenName:'image',
  parseMarkdown(token){return {type:'image',attrs:{raw:token.raw??'',alt:token.text??'',source:token.href??'',title:token.title??''}};},
  renderMarkdown(node){
    const raw=String(node.attrs?.raw??'');if(raw.includes(']('))return raw;
    // Reference definitions are resolved by marked. Save them inline so their
    // destination survives subsequent visual edits and Markdown serialization.
    const alt=String(node.attrs?.alt??'').replace(/[\[\]\\]/g,'\\$&');
    const href=String(node.attrs?.source??'').replace(/[()\\]/g,'\\$&');
    const title=String(node.attrs?.title??'').replace(/["\\]/g,'\\$&');
    return `![${alt}](${href}${title?` "${title}"`:''})`;
  },
});

export function createRichTextExtensions(onTooLong:()=>void,isReadOnly:()=>boolean=()=>false):Extensions {
  const parser=new Marked();parser.Lexer=LiteralHtmlLexer;
  return [
    StarterKit.configure({
      // Underline has no portable Markdown syntax. The toolbar exposes Markdown-safe marks.
      underline:false,trailingNode:false,
      link:{openOnClick:false,autolink:false,linkOnPaste:false,isAllowedUri:url=>safeMarkdownHref(url)!==null},
    }),
    // StarterKit unwraps standalone image paragraphs for block image nodes;
    // our inert image placeholder is inline and must remain in a paragraph.
    Extension.create({name:'workflowInlineImageParagraph',priority:1100,markdownTokenName:'paragraph',parseMarkdown(token,helpers){
      const content=helpers.parseInline(token.tokens??[]);
      const empty=content.length===1&&content[0]!.type==='text'&&content[0]!.text==='\u00a0';
      return helpers.createNode('paragraph',{},empty?[]:content);
    },renderMarkdown(node,helpers){return helpers.renderChildren(node.content??[]);}}),
    TaskList,TaskItem.configure({nested:true}),TableKit.configure({table:{resizable:false}}),ImagePlaceholder,
    Markdown.configure({marked:parser as unknown as typeof marked,markedOptions:{gfm:true,breaks:true}}),
    Extension.create({name:'workflowInstructionLimit',addProseMirrorPlugins(){
      const editor=this.editor;
      return [new Plugin({filterTransaction(transaction){
        if(!transaction.docChanged)return true;
        if(isReadOnly())return false;
        const source=editor.markdown?.serialize(transaction.doc.toJSON())??'';
        if(source.length<=20000)return true;
        onTooLong();return false;
      }})];
    }}),
  ];
}
