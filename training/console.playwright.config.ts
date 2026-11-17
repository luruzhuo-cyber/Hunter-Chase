import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const python=process.env.HUNTER_TRAINING_PYTHON||resolve('.venv/Scripts/python.exe');
export default defineConfig({testDir:'./browser-tests',workers:1,use:{viewport:{width:1440,height:1000}},webServer:{command:`"${python}" console_service.py --port 8766 --runs ../../../training-runs/browser-check`,url:'http://127.0.0.1:8766/',reuseExistingServer:false,timeout:30000}});
