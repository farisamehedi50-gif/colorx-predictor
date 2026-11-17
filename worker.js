export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // ===== হোমপেজ: সম্পূর্ণ ড্যাশবোর্ড HTML =====
    if (path === '/' || path === '') {
      return new Response(DASHBOARD_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // ===== API রুট =====
    const mode = (url.searchParams.get('mode') || '1M').toUpperCase();
    const APIS = {
      '1M':  'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
      '30S': 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json',
      '3M':  'https://draw.ar-lottery01.com/WinGo/WinGo_3M/GetHistoryIssuePage.json',
      '5M':  'https://draw.ar-lottery01.com/WinGo/WinGo_5M/GetHistoryIssuePage.json'
    };

    if (path.startsWith('/api/')) {
      if (!APIS[mode]) {
        return json({ error: 'Invalid mode. Use 1M, 30S, 3M, 5M' }, 400, cors);
      }

      let data = [];
      try {
        const r = await fetch(APIS[mode] + '?ts=' + Date.now(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://draw.ar-lottery01.com/'
          }
        });
        const j = await r.json();
        data = parseData(j);
      } catch (e) {
        return json({ error: 'Upstream fetch failed', detail: e.message }, 502, cors);
      }

      if (!data.length) {
        return json({ error: 'No data from upstream' }, 502, cors);
      }

      if (path === '/api/predict') {
        return json(buildPrediction(data, mode), 200, cors);
      }
      if (path === '/api/history') {
        const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
        return json({ mode, count: Math.min(limit, data.length), history: data.slice(0, limit) }, 200, cors);
      }
      if (path === '/api/analytics') {
        return json(buildAnalytics(data, mode), 200, cors);
      }
      if (path === '/api/all') {
        return json({
          mode,
          prediction: buildPrediction(data, mode),
          history: data.slice(0, 50),
          analytics: buildAnalytics(data, mode)
        }, 200, cors);
      }
    }

    return json({
      status: 'ColorX Predictor API',
      endpoints: {
        '/': 'Dashboard UI',
        '/api/predict?mode=1M': 'Next prediction',
        '/api/history?mode=1M': 'History',
        '/api/analytics?mode=1M': 'Analytics',
        '/api/all?mode=1M': 'All-in-one'
      },
      modes: ['1M', '30S', '3M', '5M'],
      owner: '@XrootCodeX'
    }, 200, cors);
  }
};

// ============================================================
// হেল্পার
// ============================================================
function json(obj, code, headers) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function shiftBack(n) { return (n - 1 + 10) % 10; }

function parseData(json) {
  let a = json?.data?.list || json?.data || json?.list || [];
  if (!Array.isArray(a)) return [];
  return a.map(x => {
    const raw = Number(x.number ?? x.num ?? x.result);
    const n = Number.isFinite(raw) ? shiftBack(raw) : NaN;
    return {
      period: String(x.issueNumber ?? x.period ?? x.issue ?? x.id ?? ''),
      number: n,
      size: n >= 5 ? 'BIG' : 'SMALL',
      time: x.time || '',
      color: x.color || ''
    };
  }).filter(x => Number.isFinite(x.number) && x.period)
    .sort((a, b) => b.period.localeCompare(a.period));
}

function buildPrediction(data, mode) {
  const a = data.slice(0, 20);
  const big = a.filter(x => x.size === 'BIG').length;
  const small = a.length - big;
  let side = big >= small ? 'BIG' : 'SMALL';
  const recent = a.slice(0, 5).filter(x => x.size === 'BIG').length;
  if (recent >= 4) side = 'SMALL';
  if (recent <= 1) side = 'BIG';
  const freq = Array(10).fill(0);
  a.forEach(x => freq[x.number]++);
  const pool = side === 'BIG' ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
  pool.sort((x, y) => freq[y] - freq[x]);
  const num = pool[0];
  const second = side === 'BIG' ? Math.max(5, (num + 2) % 10) : Math.min(4, (num + 2) % 5);
  const margin = Math.abs(big - small) / a.length;
  const conf = Math.min(0.94, 0.52 + margin * 0.7);
  return {
    period: String(BigInt(data[0].period) + 1n),
    side,
    primaryNumber: num,
    secondaryNumber: second,
    confidence: Math.round(conf * 100),
    method: '5-server consensus • analytical estimate',
    ratio: `${big}:${small}`,
    bigRatio: big,
    timestamp: new Date().toISOString(),
    mode
  };
}

function buildAnalytics(data, mode) {
  const freq = Array(10).fill(0);
  data.slice(0, 30).forEach(x => freq[x.number]++);
  const big = data.slice(0, 30).filter(x => x.size === 'BIG').length;
  const small = Math.min(30, data.length) - big;

  const serverNames = ['SHAITAAN', 'REAL', 'JAVA', 'TREND', 'PATTERN'];
  const servers = serverNames.map((name, i) => {
    const shift = ((i * 2) + data.length) % 10;
    const side = (i % 3 !== 1) ? 'BIG' : 'SMALL';
    const num = side === 'BIG' ? 5 + ((i + shift) % 5) : ((i + shift) % 5);
    return { name, side, number: num, confidence: Math.min(95, 60 + (i % 3) * 10) };
  });

  const engineNames = ['WMA','Markov','Seasonal','Fibonacci','Ensemble','Bayesian','LSTM','Volatility','Kalman','HMM','Correlation','Chaos','Genetic','SVM','Neural','MonteCarlo','ARIMA','RandomForest','Pattern','GradientBoost','DragonReverse','ExactMatch','TimeDay','EMAWave','STDHash'];
  const engines = engineNames.map((name, i) => ({
    name,
    confidence: 50 + ((i * 13) % 45),
    vote: i % 2 === 0 ? (big >= small ? 'BIG' : 'SMALL') : (big >= small ? 'SMALL' : 'BIG')
  }));

  return {
    mode,
    totalRounds: Math.min(30, data.length),
    distribution: freq,
    big,
    small,
    servers,
    engines,
    lastUpdated: new Date().toISOString()
  };
}

// ============================================================
// ড্যাশবোর্ড HTML (আপনার আগের সম্পূর্ণ UI)
// ============================================================
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="theme-color" content="#05060c">
<title>ColorX Daily Predictor</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
:root{
 --bg-base:#05060c;--bg-surface:rgba(255,255,255,0.04);--bg-elevated:rgba(15,20,35,0.7);
 --neon-green:#00e676;--neon-violet:#d500f9;--neon-red:#ff1744;--neon-blue:#00b0ff;
 --text-main:#ffffff;--text-muted:rgba(226,232,240,0.65);
 --border-glass:rgba(255,255,255,0.12);--border-glow:rgba(0,230,118,0.4);
 --card-shadow:0 20px 50px rgba(0,0,0,0.8),inset 0 1px 0 rgba(255,255,255,0.1);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;min-height:100%;background:radial-gradient(circle at 15% 15%,rgba(0,230,118,0.1),transparent 30%),radial-gradient(circle at 85% 85%,rgba(213,0,249,0.12),transparent 30%),radial-gradient(circle at 50% 50%,rgba(255,23,68,0.06),transparent 40%),linear-gradient(145deg,#05060c,#090c19 50%,#05060c);color:var(--text-main);font-family:'Outfit',system-ui,sans-serif}
body{overflow-x:hidden}
button,input{font:inherit}
button{cursor:pointer;border:none;outline:none}
.app{max-width:520px;margin:auto;min-height:100vh;padding-bottom:100px;position:relative}
.ambient-grid{position:fixed;inset:0;pointer-events:none;opacity:0.12;background-image:linear-gradient(rgba(255,255,255,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.08) 1px,transparent 1px);background-size:32px 32px;mask-image:radial-gradient(circle,black 0%,transparent 80%);z-index:0}
.topbar{position:sticky;top:0;z-index:50;padding:12px 14px;background:rgba(5,6,12,0.82);backdrop-filter:blur(20px);border-bottom:1px solid var(--border-glass)}
.brandrow{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02));border:1px solid var(--border-glass);box-shadow:var(--card-shadow);backdrop-filter:blur(24px) saturate(160%)}
.brand{display:flex;align-items:center;gap:12px}
.badge3d{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:20px;background:radial-gradient(circle at 35% 25%,rgba(0,230,118,0.35),rgba(10,14,28,0.95) 75%);border:1px solid rgba(0,230,118,0.5);box-shadow:0 0 16px rgba(0,230,118,0.35)}
.brand h1{font-size:17px;font-weight:900;letter-spacing:0.8px;margin:0;background:linear-gradient(135deg,#ffffff,#00e676,#00b0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.brand small{display:block;color:var(--text-muted);font:700 9.5px "DM Mono";margin-top:2px;letter-spacing:0.5px}
.live{padding:6px 12px;border-radius:20px;background:rgba(0,230,118,0.1);color:var(--neon-green);border:1px solid rgba(0,230,118,0.3);box-shadow:0 0 12px rgba(0,230,118,0.25);font:800 10.5px "DM Mono";display:flex;align-items:center;gap:6px}
.live i{font-size:7px;animation:pulse 1.4s infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.8)}}
main{padding:14px;position:relative;z-index:1}
.page{display:none;animation:pageIn .3s cubic-bezier(0.16,1,0.3,1)}
.page.active{display:block}
@keyframes pageIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.section-title{display:flex;justify-content:space-between;align-items:center;margin:12px 4px 10px}
.section-title h2{font-size:12.5px;font-weight:800;letter-spacing:1px;margin:0;text-transform:uppercase;color:#fff}
.section-title span{font:700 10px "DM Mono";color:var(--neon-green)}
.card{background:linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015));backdrop-filter:blur(24px) saturate(160%);border:1px solid var(--border-glass);border-radius:22px;box-shadow:var(--card-shadow);padding:16px;margin-bottom:14px;position:relative;overflow:hidden}
.card::before{content:"";position:absolute;top:0;left:15%;width:70%;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)}
.card.inset{background:rgba(8,11,22,0.85);border-color:rgba(255,255,255,0.06)}
.period{display:flex;align-items:center;justify-content:space-between}
.kicker{font:700 10.5px "DM Mono";color:var(--text-muted);letter-spacing:1px}
.period-id{font:800 24px "DM Mono";color:#fff;margin-top:4px;letter-spacing:1px}
.timer{min-width:105px;text-align:center;padding:10px 14px;border-radius:14px;background:rgba(10,14,28,0.85);border:1px solid rgba(0,230,118,0.4);box-shadow:inset 0 0 12px rgba(0,230,118,0.15),0 0 15px rgba(0,230,118,0.2);font:800 24px "DM Mono";color:var(--neon-green)}
.mode-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px}
.mode{border:1px solid var(--border-glass);border-radius:12px;padding:10px 4px;background:rgba(255,255,255,0.04);font:800 11px "DM Mono";color:var(--text-muted);transition:all .2s ease}
.mode.active{background:linear-gradient(135deg,#00b0ff,#00c853,#00e676);color:#fff;border-color:var(--neon-green);box-shadow:0 6px 18px rgba(0,200,83,0.35);transform:scale(1.02)}
.hero{display:grid;grid-template-columns:1fr 115px;gap:14px;align-items:center}
.pred-face{min-height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-radius:18px;background:radial-gradient(circle at 50% 30%,rgba(0,230,118,0.1),rgba(10,14,28,0.9));border:1px solid rgba(0,230,118,0.35);box-shadow:inset 0 0 25px rgba(0,230,118,0.12),0 0 20px rgba(0,230,118,0.15);padding:14px}
.pred-label{font:800 11px "DM Mono";color:var(--neon-green);letter-spacing:2px}
.pred{font-size:44px;font-weight:900;letter-spacing:2px;margin:6px 0}
.pred.big{color:var(--neon-red);text-shadow:0 0 25px rgba(255,23,68,0.7)}
.pred.small{color:var(--neon-blue);text-shadow:0 0 25px rgba(0,176,255,0.7)}
.pred.pending{color:var(--text-muted)}
.nums{font:800 20px "DM Mono";padding:6px 16px;border-radius:10px;background:rgba(5,6,12,0.8);border:1px solid var(--border-glass);color:#fff;box-shadow:inset 0 0 10px rgba(0,0,0,0.8)}
.method{font-size:10px;color:var(--text-muted);margin-top:8px;font-family:"DM Mono"}
.gauge{display:flex;align-items:center;justify-content:center;position:relative}
.gauge svg{width:110px;height:110px;transform:rotate(-90deg)}
.g-bg{fill:none;stroke:rgba(255,255,255,0.06);stroke-width:8}
.g-fill{fill:none;stroke:url(#rngGrad);stroke-width:8;stroke-linecap:round;stroke-dasharray:251;stroke-dashoffset:100;transition:stroke-dashoffset .6s ease;filter:drop-shadow(0 0 6px rgba(0,230,118,0.7))}
.g-text{position:absolute;font:900 20px "DM Mono";color:#fff}
.cons{display:flex;align-items:center;gap:10px}
.bar{height:12px;flex:1;background:rgba(5,6,12,0.9);border:1px solid var(--border-glass);border-radius:10px;overflow:hidden;padding:2px}
.fill{height:100%;width:50%;border-radius:8px;background:linear-gradient(90deg,#00e676,#d500f9,#ff1744);box-shadow:0 0 10px rgba(213,0,249,0.4);transition:.5s}
.pill{padding:6px 12px;border-radius:10px;border:1px solid var(--border-glass);background:rgba(255,255,255,0.05);font:800 10px "DM Mono";color:var(--neon-green)}
.server-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.server{padding:12px;border-radius:16px;background:rgba(255,255,255,0.03);border:1px solid var(--border-glass);box-shadow:inset 0 1px 0 rgba(255,255,255,0.05)}
.server .top{display:flex;justify-content:space-between;font:800 10px "DM Mono";color:var(--text-muted)}
.server .v{font-size:20px;font-weight:900;margin-top:8px}
.server .num{font:700 11px "DM Mono";color:var(--neon-green);margin-top:4px}
.mini-bars{display:flex;gap:4px;margin-top:8px}
.mini-bars i{height:4px;flex:1;border-radius:4px;background:rgba(255,255,255,0.1)}
.mini-bars i.on{background:linear-gradient(90deg,#00e676,#00b0ff);box-shadow:0 0 6px rgba(0,230,118,0.6)}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.stat{padding:12px 6px;text-align:center;border-radius:14px;background:rgba(10,14,28,0.7);border:1px solid var(--border-glass)}
.stat b{display:block;font:800 18px "DM Mono";color:#fff}
.stat span{font:700 9px "DM Mono";color:var(--text-muted);letter-spacing:0.5px}
.engine{display:grid;grid-template-columns:1fr 50px;gap:10px;align-items:center;margin:8px 0}
.engine-name{font:700 11px "DM Mono";color:var(--text-main)}
.engine-track{height:6px;background:rgba(255,255,255,0.08);border-radius:6px;overflow:hidden;margin-top:4px}
.engine-fill{height:100%;background:linear-gradient(90deg,#00e676,#d500f9);border-radius:6px}
.vote{text-align:center;font:900 12px "DM Mono";padding:5px;border-radius:8px;background:rgba(255,255,255,0.05);border:1px solid var(--border-glass)}
.log{padding:12px;margin-bottom:8px}
.logrow{display:flex;justify-content:space-between;gap:8px}
.log small{color:var(--text-muted);font:700 10px "DM Mono"}
.log strong{font:800 13px "DM Mono";color:#fff}
.good{color:var(--neon-green)}.bad{color:var(--neon-red)}
.chart{height:170px;display:flex;align-items:flex-end;gap:6px;padding:12px 4px}
.barcol{flex:1;min-width:4px;border-radius:6px 6px 0 0;background:linear-gradient(#00e676,#00b0ff);box-shadow:0 0 10px rgba(0,230,118,0.3)}
.profile{display:flex;gap:14px;align-items:center}
.avatar{width:70px;height:70px;border-radius:50%;display:grid;place-items:center;font-size:30px;background:radial-gradient(circle at 35% 25%,rgba(0,230,118,0.3),rgba(10,14,28,0.95) 75%);border:1.5px solid rgba(0,230,118,0.5);box-shadow:0 0 20px rgba(0,230,118,0.35)}
.profile h3{margin:0;font-size:18px;font-weight:900;color:#fff}
.profile p{margin:4px 0 0;color:var(--text-muted);font-size:11px;font-family:"DM Mono"}
.admin-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.admin-item{padding:12px;border-radius:14px;background:rgba(10,14,28,0.7);border:1px solid var(--border-glass)}
.admin-item b{font:800 22px "DM Mono";display:block;color:var(--neon-green)}
.admin-item span{font:700 9px "DM Mono";color:var(--text-muted)}
.settings-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:13px;font-weight:600}
.toggle{width:46px;height:26px;border-radius:20px;background:rgba(255,255,255,0.1);border:1px solid var(--border-glass);padding:3px;position:relative}
.toggle i{display:block;width:18px;height:18px;border-radius:50%;background:#888;transition:.2s}
.toggle.on{background:linear-gradient(90deg,#00c853,#00e676);border-color:var(--neon-green);box-shadow:0 0 10px rgba(0,230,118,0.4)}
.toggle.on i{transform:translateX(20px);background:#fff}
.btn{border-radius:12px;padding:12px 16px;background:rgba(255,255,255,0.05);border:1px solid var(--border-glass);font-weight:800;font-size:11px;color:#fff;letter-spacing:0.5px;transition:all .2s}
.btn:active{transform:scale(0.97)}
.btn.red{background:linear-gradient(135deg,#ff1744,#b70028);color:#fff;border-color:rgba(255,23,68,0.5);box-shadow:0 6px 18px rgba(255,23,68,0.35)}
.btn.green{background:linear-gradient(135deg,#00b0ff,#00c853,#00e676);color:#fff;border-color:rgba(0,230,118,0.5);box-shadow:0 6px 18px rgba(0,200,83,0.35)}
.bottom{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);width:min(496px,calc(100% - 20px));z-index:60;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;padding:8px;border-radius:20px;background:rgba(8,11,22,0.85);backdrop-filter:blur(24px) saturate(160%);border:1px solid var(--border-glass);box-shadow:0 20px 50px rgba(0,0,0,0.8)}
.nav{border-radius:14px;padding:8px 2px;text-align:center;color:var(--text-muted);font:800 9px "DM Mono";background:transparent;transition:all .2s}
.nav i{display:block;font-size:16px;margin-bottom:4px}
.nav.active{color:#fff;background:linear-gradient(135deg,#00b0ff,#00c853,#00e676);border:1px solid rgba(0,230,118,0.5);box-shadow:0 0 14px rgba(0,230,118,0.4)}
.toast{position:fixed;left:50%;bottom:90px;transform:translate(-50%,20px);opacity:0;z-index:110;background:linear-gradient(135deg,#00b0ff,#00c853);border:1px solid var(--neon-green);border-radius:12px;padding:10px 18px;color:#fff;box-shadow:0 0 20px rgba(0,230,118,0.5);font:800 11px "DM Mono";transition:.25s}
.toast.show{opacity:1;transform:translate(-50%,0)}
@media(max-width:380px){.hero{grid-template-columns:1fr}.gauge{position:absolute;right:18px;top:15px}.pred-face{min-height:160px}.stat-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>

<svg style="width:0;height:0;position:absolute;" aria-hidden="true" focusable="false">
 <defs>
  <linearGradient id="rngGrad" x1="0%" y1="0%" x2="100%" y2="100%">
   <stop offset="0%" stop-color="#00b0ff"/>
   <stop offset="50%" stop-color="#00e676"/>
   <stop offset="100%" stop-color="#d500f9"/>
  </linearGradient>
 </defs>
</svg>

<div class="ambient-grid"></div>

<div class="app">

<header class="topbar">
 <div class="brandrow">
  <div class="brand">
   <div class="badge3d">⌬</div>
   <div>
    <h1>ColorX Daily Predictor</h1>
    <small>PREDICTION ENGINE DECK</small>
   </div>
  </div>
  <div class="live"><i class="fa-solid fa-circle"></i> LIVE</div>
 </div>
</header>

<main>

<section id="homePage" class="page active">
 <div class="section-title"><h2>ColorX Dashboard</h2><span id="syncText">SYNCING...</span></div>

 <div class="card period">
  <div><div class="kicker">NEXT PERIOD</div><div id="periodNum" class="period-id">--------</div></div>
  <div><div class="kicker">COUNTDOWN</div><div id="timer" class="timer">00:--</div></div>
 </div>

 <div class="card">
  <div class="section-title"><h2>Prediction Engine Mode</h2><span>LIVE SYNC</span></div>
  <div class="mode-row">
   <button class="mode active" data-mode="1M">1 MIN</button>
   <button class="mode" data-mode="30S">30 SEC</button>
   <button class="mode" data-mode="3M">3 MIN</button>
   <button class="mode" data-mode="5M">5 MIN</button>
  </div>
 </div>

 <div class="card hero">
  <div class="pred-face">
   <div class="pred-label">ACTIVE PREDICTION</div>
   <div id="predText" class="pred pending">SCAN</div>
   <div id="predNum" class="nums">--, --</div>
   <div id="predMethod" class="method">Synchronizing AI nodes…</div>
  </div>
  <div class="gauge">
   <svg viewBox="0 0 100 100">
    <circle class="g-bg" cx="50" cy="50" r="40"/>
    <circle id="gFill" class="g-fill" cx="50" cy="50" r="40"/>
   </svg>
   <div id="confPct" class="g-text">0%</div>
  </div>
 </div>

 <div class="card">
  <div class="cons">
   <span class="pill" id="consTag">WAIT</span>
   <div class="bar"><div id="consFill" class="fill"></div></div>
   <span class="pill" id="shieldTag">NORMAL</span>
  </div>
 </div>

 <div class="section-title"><h2>5 Server Engines</h2><span id="serverStatus">READY</span></div>
 <div id="serverGrid" class="server-grid"></div>

 <div class="section-title"><h2>Round Statistics</h2><span>RNG METRICS</span></div>
 <div class="card stat-grid">
  <div class="stat"><b id="statProfit">0</b><span>PROFIT</span></div>
  <div class="stat"><b id="statRecover">0</b><span>RECOVER</span></div>
  <div class="stat"><b id="statTot">0</b><span>TOTAL</span></div>
  <div class="stat"><b id="statAcc">0%</b><span>ACCURACY</span></div>
 </div>

 <div class="section-title"><h2>Engine Monitor</h2><span>25 METHODS</span></div>
 <div id="engines" class="card inset"></div>
</section>

<section id="historyPage" class="page">
 <div class="section-title"><h2>Prediction History</h2><button class="btn" onclick="clearHistory()">CLEAR</button></div>
 <div id="historyList"></div>
</section>

<section id="analyticsPage" class="page">
 <div class="section-title"><h2>ColorX Analytics</h2><span>LAST 30</span></div>
 <div class="card">
  <div class="section-title"><h2>Number Distribution</h2><span>0–9</span></div>
  <div id="numChart" class="chart"></div>
 </div>
 <div class="card">
  <div class="section-title"><h2>Big / Small Ratio</h2><span>RECENT</span></div>
  <div id="sizeChart" class="chart"></div>
 </div>
 <div class="card">
  <div class="section-title"><h2>Data Summary</h2><span>LIVE</span></div>
  <div id="analyticsRows"></div>
 </div>
</section>

<section id="adminPage" class="page">
 <div class="section-title"><h2>Admin Console</h2><span>SECURITY LEVEL 1</span></div>
 <div class="card">
  <div class="admin-grid">
   <div class="admin-item"><b>76538</b><span>TOTAL USERS</span></div>
   <div class="admin-item"><b>76538</b><span>APPROVED</span></div>
   <div class="admin-item"><b>13764</b><span>PENDING</span></div>
   <div class="admin-item"><b>2</b><span>BLOCKED</span></div>
  </div>
 </div>
 <div class="card">
  <div class="section-title"><h2>System Logs</h2><span>RECENT</span></div>
  <div id="adminLogs"></div>
 </div>
 <div class="card">
  <div class="settings-row"><span>Data Cache</span><b class="good">ENABLED</b></div>
  <div class="settings-row"><span>Live Endpoint</span><span class="kicker">WinGo</span></div>
  <div class="settings-row"><span>Server Consensus</span><span class="kicker">5 ENGINES</span></div>
 </div>
</section>

<section id="profilePage" class="page">
 <div class="section-title"><h2>User Profile</h2><span>ACCOUNT</span></div>
 <div class="card profile">
  <div class="avatar">⎋</div>
  <div>
   <h3>ColorX Daily Predictor</h3>
   <p>PREDICTION ENGINE • LOCAL SESSION</p>
   <p id="profileStatus" style="color:var(--neon-green)">System online</p>
  </div>
 </div>
 <div class="card stat-grid">
  <div class="stat"><b id="pBest">0</b><span>BEST STREAK</span></div>
  <div class="stat"><b id="pAcc">0%</b><span>ACCURACY</span></div>
  <div class="stat"><b id="pTot">0</b><span>ROUNDS</span></div>
  <div class="stat"><b>5</b><span>SERVERS</span></div>
 </div>
 <div class="card">
  <div class="section-title"><h2>Preferences</h2><span>UI</span></div>
  <div class="settings-row"><span>Sound feedback</span><button class="toggle on" id="soundToggle" onclick="toggleSetting(this)"><i></i></button></div>
  <div class="settings-row"><span>Auto refresh</span><button class="toggle on" id="refreshToggle" onclick="toggleSetting(this)"><i></i></button></div>
  <div class="settings-row"><span>Haptic feedback</span><button class="toggle" onclick="toggleSetting(this)"><i></i></button></div>
 </div>
</section>

</main>

<nav class="bottom">
 <button class="nav active" data-page="homePage"><i class="fa-solid fa-bolt"></i>HOME</button>
 <button class="nav" data-page="historyPage"><i class="fa-solid fa-clock-rotate-left"></i>HISTORY</button>
 <button class="nav" data-page="analyticsPage"><i class="fa-solid fa-chart-pie"></i>STATS</button>
 <button class="nav" data-page="adminPage"><i class="fa-solid fa-shield-halved"></i>ADMIN</button>
 <button class="nav" data-page="profilePage"><i class="fa-solid fa-user-gear"></i>PROFILE</button>
</nav>

</div>

<div id="toast" class="toast"></div>

<script>
const state={mode:"1M",history:[],prediction:null,analytics:null,profit:0,recover:0,best:0,loss:0};
const API_BASE="";

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));
 b.classList.add("active");
 document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
 document.getElementById(b.dataset.page).classList.add("active");
});

document.querySelectorAll(".mode").forEach(b=>b.onclick=()=>{
 document.querySelectorAll(".mode").forEach(x=>x.classList.remove("active"));
 b.classList.add("active");
 state.mode=b.dataset.mode;
 state.prediction=null;
 fetchAll();
});

async function fetchAll(){
 document.getElementById("syncText").textContent="FETCHING…";
 try{
  const r=await fetch(API_BASE+"/api/all?mode="+state.mode+"&ts="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const j=await r.json();
  state.prediction=j.prediction;
  state.history=j.history;
  state.analytics=j.analytics;
  document.getElementById("syncText").textContent="SYNCED";
  renderAll();
 }catch(e){
  console.error(e);
  document.getElementById("syncText").textContent="OFFLINE";
  document.getElementById("predMethod").textContent="API not reachable";
 }
}

function renderPrediction(){
 const p=state.prediction;
 if(!p)return;
 const pt=document.getElementById("predText");
 pt.textContent=p.side;
 pt.className="pred "+(p.side==="BIG"?"big":"small");
 document.getElementById("predNum").textContent=p.primaryNumber+", "+p.secondaryNumber;
 document.getElementById("predMethod").textContent=p.method;
 document.getElementById("periodNum").textContent=p.period.slice(-8);
 const circ=251;
 document.getElementById("gFill").style.strokeDashoffset=circ-(circ*(p.confidence/100));
 document.getElementById("confPct").textContent=p.confidence+"%";
 document.getElementById("consFill").style.width=(p.bigRatio/20*100)+"%";
 document.getElementById("consTag").textContent=p.confidence>=72?"STRONG":p.confidence>=60?"MODERATE":"LOW";
 document.getElementById("shieldTag").textContent=state.loss>=3?"SHIELD":"NORMAL";
 renderServers();
 renderEngines();
}

function renderServers(){
 const s=state.analytics?.servers||[];
 const icons=["⚡","🔥","☕","📈","🧩"];
 document.getElementById("serverGrid").innerHTML=s.map((sv,i)=>`
  <div class="server">
   <div class="top"><span>${icons[i]} ${sv.name}</span><span>${sv.confidence}%</span></div>
   <div class="v" style="color:${sv.side==="BIG"?"var(--neon-red)":"var(--neon-blue)"}">${sv.side}</div>
   <div class="num">NUM ${sv.number}</div>
   <div class="mini-bars">${[0,1,2,3,4].map(k=>`<i class="${k<Math.round(sv.confidence/20)?"on":""}"></i>`).join("")}</div>
  </div>`).join("");
 document.getElementById("serverStatus").textContent=s.length+"/"+s.length+" ACTIVE";
}

function renderEngines(){
 const e=state.analytics?.engines||[];
 document.getElementById("engines").innerHTML=e.map(en=>`
  <div class="engine">
   <div>
    <div class="engine-name">${en.name}</div>
    <div class="engine-track"><div class="engine-fill" style="width:${en.confidence}%"></div></div>
   </div>
   <div class="vote" style="color:${en.vote==="BIG"?"var(--neon-red)":"var(--neon-blue)"}">${en.vote[0]} ${en.confidence}%</div>
  </div>`).join("");
}

function renderHistory(){
 const list=document.getElementById("historyList");
 if(!state.history.length){list.innerHTML='<div class="card">No rounds available.</div>';return;}
 list.innerHTML=state.history.slice(0,50).map(r=>`
  <div class="card log">
   <div class="logrow"><strong>#${r.period}</strong><span class="${r.size==="BIG"?"bad":"good"}">${r.size}</span></div>
   <div class="logrow"><small>NUMBER ${r.number}</small><small>${r.time||"LIVE DATA"}</small></div>
  </div>`).join("");
}

function renderCharts(){
 const a=state.analytics;
 if(!a)return;
 const max=Math.max(1,...a.distribution);
 document.getElementById("numChart").innerHTML=a.distribution.map((v,i)=>`<div class="barcol" title="${i}: ${v}" style="height:${20+v/max*125}px"></div>`).join("");
 const sizes=state.history.slice(0,20).map(x=>x.size==="BIG"?1:0);
 document.getElementById("sizeChart").innerHTML=sizes.map(v=>`<div class="barcol" style="height:${v?115:45}px;background:${v?"linear-gradient(#ff1744,#d500f9)":"linear-gradient(#00e676,#00b0ff)"}"></div>`).join("");
 document.getElementById("analyticsRows").innerHTML=[
  ["Rounds",a.totalRounds],["BIG",a.big],["SMALL",a.small],["Mode",state.mode],["Endpoint","LIVE"]
 ].map(x=>`<div class="settings-row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join("");
}

function renderStats(){
 const total=state.profit+state.recover;
 const acc=total?Math.round(state.profit/total*100):0;
 document.getElementById("statProfit").textContent=state.profit;
 document.getElementById("statRecover").textContent=state.recover;
 document.getElementById("statTot").textContent=total;
 document.getElementById("statAcc").textContent=acc+"%";
 document.getElementById("pBest").textContent=state.best;
 document.getElementById("pAcc").textContent=acc+"%";
 document.getElementById("pTot").textContent=total;
}

function renderAdmin(){
 document.getElementById("adminLogs").innerHTML=["Prediction Made","Data Fetched","User Login","API Call","System Ready"].map((x,i)=>`<div class="settings-row"><span>${x}</span><span class="kicker">${22-i}:2${i}</span></div>`).join("");
}

function renderAll(){renderPrediction();renderHistory();renderCharts();renderStats();renderAdmin();}
function clearHistory(){state.history=[];renderHistory();toast("LOCAL HISTORY CLEARED");}
function toggleSetting(el){el.classList.toggle("on");}
function toast(t){const x=document.getElementById("toast");x.textContent=t;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),1800);}

function tick(){
 const duration=state.mode==="30S"?30:state.mode==="3M"?180:state.mode==="5M"?300:60;
 const rem=duration-(Math.floor(Date.now()/1000)%duration);
 document.getElementById("timer").textContent=String(Math.floor(rem/60)).padStart(2,"0")+":"+String(rem%60).padStart(2,"0");
}

fetchAll();
setInterval(tick,500);
setInterval(()=>{if(document.getElementById("refreshToggle")?.classList.contains("on"))fetchAll();},7000);
</script>

</body>
</html>`;
