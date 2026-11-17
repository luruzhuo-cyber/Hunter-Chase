import {afterEach,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';

describe('laboratory monitor controls',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('exposes pre-match setup and independently labelled audio channels',async()=>{
  vi.stubGlobal('location',new URL('http://localhost/?mode=demon&seed=1701'));
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  const {DemonApp}=await import('./DemonApp');
  const html=renderToStaticMarkup(createElement(DemonApp));
  expect(html).toContain('aria-label="环境音量"');
  expect(html).toContain('aria-label="事件音量"');
  expect(html).toContain('aria-label="追逐音量"');
  expect(html).toContain('监控设置');
  expect(html).toContain('试听音效');
  expect(html).toContain('1701');
 });
});
