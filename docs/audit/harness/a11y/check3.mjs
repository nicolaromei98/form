const hex=(h,a=1)=>({r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16),a});
const rgba=(r,g,b,a=1)=>({r,g,b,a});
const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
const lin=c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4};
const L=c=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
const R=(a,b)=>{const[x,y]=[L(a),L(b)].sort((p,q)=>q-p);return +((x+0.05)/(y+0.05)).toFixed(2)};
const ink=hex("#0c0c0c");
for (const a of [0.36,0.4]) console.log("white",a,"on ink card",R(over(rgba(255,255,255,a),ink),ink));
const paper=hex("#e9e9e6"), glass=over(rgba(255,255,255,.52),paper);
// switch: proposed off track line-strong .46 vs paper; knob white vs track
const track=over(rgba(10,10,10,.46),paper);
console.log("switch off track .46 vs paper",R(track,paper),"knob white vs track",R(hex("#ffffff"),track));
// editable focus ring .46 on white 92% fill
const fill=over(rgba(255,255,255,.92),glass);
console.log("editable ring .46 vs fill",R(over(rgba(10,10,10,.46),fill),fill));
// text-3 at 0.40 for the v1 diagnosis check
console.log("ink .40 on paper",R(over(rgba(10,10,10,.40),paper),paper));
// avatar ring signal-graphic vs paper
console.log("#e8261b vs paper",R(hex("#e8261b"),paper));
// over-capacity hatch with signal-graphic stripes at 0.55 alpha vs glass
for (const a of [0.45,0.55,0.6]) console.log("hatch #e8261b @",a,"vs glass",R(over({...hex("#e8261b"),a},glass),glass));
