@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo [1/5] 检查 Python 训练环境...
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv 2>nul || python -m venv .venv
  if errorlevel 1 goto :failed
)
if not exist ".venv\.dependencies-ready" (
  ".venv\Scripts\python.exe" -m pip install -e ".[test]"
  if errorlevel 1 goto :failed
  type nul > ".venv\.dependencies-ready"
)
echo [2/5] 训练 PPO（默认每方 250000 步，耗时取决于 CPU）...
if exist "..\public\models\candidate\metrics.json" (
  ".venv\Scripts\python.exe" train.py --generations 1 --steps 250000 --seed 1701 --output "..\public\models\candidate" --resume
) else (
  ".venv\Scripts\python.exe" train.py --generations 1 --steps 250000 --seed 1701 --output "..\public\models\candidate"
)
if errorlevel 1 goto :failed
echo [3/5] 用 200 个固定种子评估候选模型...
".venv\Scripts\python.exe" evaluate.py --seeds 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119 120 121 122 123 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138 139 140 141 142 143 144 145 146 147 148 149 150 151 152 153 154 155 156 157 158 159 160 161 162 163 164 165 166 167 168 169 170 171 172 173 174 175 176 177 178 179 180 181 182 183 184 185 186 187 188 189 190 191 192 193 194 195 196 197 198 199 200 --verify-determinism --runner-policy "..\public\models\candidate\runner-policy.json" --hunter-policy "..\public\models\candidate\hunter-policy.json" --output "..\public\models\candidate\evaluation.json"
if errorlevel 1 goto :failed
echo [4/5] 校验评估并发布到浏览器 current 模型...
".venv\Scripts\python.exe" promote_models.py --candidate "..\public\models\candidate" --evaluation "..\public\models\candidate\evaluation.json" --destination "..\public\models\current" --expected-episodes 200
if errorlevel 1 goto :failed
echo [5/5] 完成。重新启动网页后选择“Current”模型。
pause
exit /b 0
:failed
echo.
echo 训练或评估失败，候选模型没有发布到 current。请保留本窗口查看上方错误。
pause
exit /b 1
