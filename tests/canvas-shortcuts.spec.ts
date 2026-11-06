import { describe, expect, it } from 'vitest';
import { canvasShortcut } from '../src/client/canvas-shortcuts.ts';
import { compactNodeHeight, estimateQuestionHeight } from '../src/client/graph.ts';

const key=(key:string,extra:Partial<Parameters<typeof canvasShortcut>[0]>={})=>canvasShortcut({key,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,isComposing:false,...extra});
describe('Canvas shortcuts and compact geometry',()=>{
  it.each([['a','selectAll'],['d','duplicate'],['c','copy'],['v','paste'],['x','cut'],['z','undo'],['y','redo'],['g','group']] as const)('routes Ctrl+%s and Command+%s to the same canvas action',(letter,action)=>{expect(key(letter,{ctrlKey:true})).toBe(action);expect(key(letter,{metaKey:true})).toBe(action);});
  it('supports modifier-specific grouping, history, restore, fit and help without consuming browser Find or Space pan',()=>{
    expect(key('z',{ctrlKey:true,shiftKey:true})).toBe('redo');expect(key('g',{ctrlKey:true,shiftKey:true})).toBe('ungroup');expect(key('h',{ctrlKey:true,shiftKey:true})).toBe('restore');expect(key('F2')).toBe('rename');expect(key('Delete')).toBe('delete');expect(key('Backspace')).toBe('delete');expect(key('f')).toBe('fitAll');expect(key('F',{shiftKey:true})).toBe('fitSelected');expect(key('?')).toBe('help');expect(key('/',{shiftKey:true})).toBe('help');expect(key('f',{ctrlKey:true})).toBeUndefined();expect(key(' ')).toBeUndefined();
  });
  it('leaves IME, Alt shortcuts and unassigned modifier combinations alone',()=>{expect(key('d',{ctrlKey:true,isComposing:true})).toBeUndefined();expect(key('g',{ctrlKey:true,altKey:true})).toBeUndefined();expect(key('a',{ctrlKey:true,shiftKey:true})).toBeUndefined();});
  it('bounds compact height using content and saved expanded geometry without mutating either',()=>{
    expect(compactNodeHeight(20,500)).toBe(96);expect(compactNodeHeight(80,500)).toBe(133);expect(compactNodeHeight(5000,500)).toBe(184);expect(compactNodeHeight(5000,180)).toBe(156);expect(compactNodeHeight(Number.NaN,500)).toBe(96);expect(estimateQuestionHeight('A short task',300)).toBeCloseTo(21.6,0);expect(estimateQuestionHeight('A very long instruction '.repeat(80),240)).toBeGreaterThan(estimateQuestionHeight('A very long instruction '.repeat(80),600));
  });
});
