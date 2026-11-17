export const RUNNER_PROFILES=[
  {id:'lighthouse',number:'01',name:'灯塔',trait:'合作救援',risk:0.25,rescue:1.0,terminal:0.75,decoy:0.3},
  {id:'grayfox',number:'02',name:'灰狐',trait:'藏匿门禁',risk:0.1,rescue:0.35,terminal:0.55,decoy:0.25},
  {id:'moth',number:'03',name:'飞蛾',trait:'高风险近路',risk:1,rescue:0.2,terminal:0.7,decoy:0.15},
  {id:'locksmith',number:'04',name:'锁匠',trait:'终端规划',risk:0.35,rescue:0.35,terminal:1,decoy:0.1},
  {id:'echo',number:'05',name:'回声',trait:'噪声误导',risk:0.65,rescue:0.3,terminal:0.45,decoy:1},
  {id:'lonewolf',number:'06',name:'独狼',trait:'保存资源',risk:0.4,rescue:0.05,terminal:0.55,decoy:0.25},
  {id:'raven',number:'07',name:'渡鸦',trait:'观察跟随',risk:0.3,rescue:0.5,terminal:0.5,decoy:0.2},
  {id:'watchman',number:'08',name:'守夜人',trait:'猎人侦察',risk:0.8,rescue:0.65,terminal:0.45,decoy:0.5},
] as const;
export const profileById=(id:string)=>RUNNER_PROFILES.find(p=>p.id===id)!;
