const hex = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
const over = (fg, a, bg) => fg.map((c,i) => a*c + (1-a)*bg[i]);
const lin = c => { c/=255; return c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
const L = rgb => 0.2126*lin(rgb[0]) + 0.7152*lin(rgb[1]) + 0.0722*lin(rgb[2]);
const cr = (a,b) => { const [x,y]=[L(a),L(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
const f = n => n.toFixed(2);
const INK = hex("#0a0a0a"), PAPER = hex("#e9e9e6"), PAPER_HI = hex("#f2f2ef"), PAPER_LO = hex("#dcdcd8"), WHITE=[255,255,255], RED = hex("#ff3b2f"), ON_INK=hex("#f4f4f2");
const GLASS = over(WHITE, 0.52, PAPER);            // .glass card over paper (blur of a flat ground ~ the ground)
const GLASS_HI = over(hex("#fafaf8"), 0.92, PAPER); // .glass-hi
const BOARD = over(WHITE, 0.72, PAPER);             // board card background
const rows = [];
const add = (label, fg, bg) => rows.push([label, f(cr(fg,bg))]);
for (const [name, bg] of [["paper #e9e9e6", PAPER], ["paper-lo #dcdcd8 (ground edge)", PAPER_LO], ["glass card (white 52% on paper)", GLASS], ["glass-hi (92%)", GLASS_HI]]) {
  for (const a of [0.2, 0.38, 0.40, 0.58, 1]) add(`ink ${Math.round(a*100)}% on ${name}`, over(INK,a,bg), bg);
}
// alpha needed for 4.5:1 and 3:1
for (const [name,bg] of [["paper",PAPER],["glass card",GLASS],["glass-hi",GLASS_HI]]) {
  for (const target of [4.5, 3]) { let a=0; while (cr(over(INK,a,bg),bg) < target) a+=0.005; rows.push([`min ink alpha for ${target}:1 on ${name}`, (a*100).toFixed(1)+"%"]); }
}
add("#ff3b2f text on paper", RED, PAPER);
add("#ff3b2f on glass card", RED, GLASS);
add("#ff3b2f on glass-hi", RED, GLASS_HI);
add("#ff3b2f dot on white board card", RED, BOARD);
add("#c0221a on paper (v1 proposal)", hex("#c0221a"), PAPER);
// dimmed card: whole <article> at opacity .55 over paper (TaskCard.tsx:104)
const dimBg = over(GLASS, 0.55, PAPER);
for (const a of [1, 0.58, 0.38]) add(`dimmed tracker card (opacity .55): ink ${Math.round(a*100)}% text`, over(over(INK,a,GLASS),0.55,PAPER), dimBg);
const dimBoardBg = over(BOARD, 0.55, PAPER);
add(`dimmed board card (opacity .55): ink 100% title`, over(INK,0.55,PAPER), dimBoardBg);
add(`dimmed board card: ink 38% meta`, over(over(INK,0.38,BOARD),0.55,PAPER), dimBoardBg);
// team segment dim .5 (TeamView.tsx:443): bg white 90%
const SEG = over(WHITE,0.9,GLASS);
add(`dimmed team segment (opacity .5): title`, over(over(INK,1,SEG),0.5,GLASS), over(SEG,0.5,GLASS));
// on-ink
for (const a of [0.34, 0.6]) add(`on-ink ${Math.round(a*100)}% on ink #0a0a0a`, over(ON_INK,a,INK), INK);
for (const [k,v] of rows) console.log(k.padEnd(62), v);
