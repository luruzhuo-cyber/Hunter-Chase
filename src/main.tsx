import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './ui/App';
import {PursuitApp} from './ui/PursuitApp';
import {DemonApp} from './ui/DemonApp';

import './ui/styles.css';
const mode=new URLSearchParams(location.search).get('mode');
createRoot(document.getElementById('root')!).render(<React.StrictMode>{mode==='heist'&&<aside role='status'>双队夺能已撤下，当前为猎场主页。</aside>}{mode==='demon'?<DemonApp/>:mode==='pursuit'?<PursuitApp/>:<App/>}</React.StrictMode>);

